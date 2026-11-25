/* ============================================================
   store-core.ts — port of js/store.js.
   localStorage persistence, overlay/changelog, queue carry-forward,
   config, validation ledger.

   PORT NOTE: the legacy module was a singleton object closing over the
   `localStorage` global and an `alert()` on quota failure. Here it is a
   factory taking a `Persistence` port, so the same object can run against
   real localStorage (browser), an in-memory map (Vitest), or a seeded
   legacy blob. Method names, mutation order, `unshift` vs `push`, slice
   caps and save timing are unchanged.

   The blob written is the legacy `sentinel.v1` shape verbatim — the whole
   state object, no zustand `{state, version}` wrapper.
   ============================================================ */

import type {
  Device,
  OutcomeInput,
  QueueMeta,
  Run,
  SentinelState,
  StoreApi,
  StoredConfig,
  WorkEntry,
  WorkState,
} from './types';

export const STORE_KEY = 'sentinel.v1';
export const SCHEMA_VERSION = 1;

/* the queue state machine — canonical raw states */
export const QUEUE_STATES = [
  'NEW',
  'TRIAGED',
  'ACTIONED',
  'RESOLVED',
  'DEFERRED',
  'FALSE_POSITIVE',
] as const;

export function normState(raw: unknown): string {
  const v = String(raw || '')
    .toUpperCase()
    .replace(/[\s-]/g, '_');
  const alias: Record<string, string> = {
    DONE: 'RESOLVED',
    CLOSED: 'RESOLVED',
    FP: 'FALSE_POSITIVE',
    IN_PROGRESS: 'ACTIONED',
    WIP: 'ACTIONED',
  };
  const s = alias[v] || v;
  return (QUEUE_STATES as readonly string[]).includes(s) ? s : 'NEW';
}

export function mapStateToWork(raw: unknown): WorkState {
  const s = normState(raw);
  if (s === 'RESOLVED' || s === 'FALSE_POSITIVE') return 'done';
  if (s === 'TRIAGED' || s === 'ACTIONED' || s === 'DEFERRED') return 'inprogress';
  return 'notstarted';
}

export function isClosedState(raw: unknown): boolean {
  const s = normState(raw);
  return s === 'RESOLVED' || s === 'FALSE_POSITIVE';
}

/** The only thing the store needs from the outside world. */
export interface Persistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface StoreOptions {
  /** called instead of `alert()` when a write fails (quota / blocked storage) */
  onQuotaError?: (message: string) => void;
  /** called after every successful save — the React binding subscribes here */
  onChange?: (state: SentinelState) => void;
}

export function blankState(): SentinelState {
  return {
    schemaVersion: SCHEMA_VERSION,
    committedRun: null,
    runHistory: [],
    changelog: [],
    handoffLog: [],
    workState: {},
    queueMeta: {},
    config: null,
    outcomes: [],
    lastTuning: null,
    updated: null,
  };
}

export interface SentinelStore extends StoreApi {
  /** current in-memory state without forcing a load (test/introspection aid) */
  _peek(): SentinelState | null;
}

export function createStore(
  persistence: Persistence,
  options: StoreOptions = {},
): SentinelStore {
  let _state: SentinelState | null = null;

  const notify = (): void => {
    if (options.onChange && _state) options.onChange(_state);
  };

  const store: SentinelStore = {
    _peek() {
      return _state;
    },

    load(): SentinelState {
      if (_state) return _state;
      try {
        const raw = persistence.getItem(STORE_KEY);
        _state = raw ? (JSON.parse(raw) as SentinelState) : blankState();
      } catch {
        _state = blankState();
      }
      if (!_state.schemaVersion) _state = blankState();
      return _state;
    },

    save(): boolean {
      try {
        (_state as SentinelState).updated = new Date().toISOString();
        persistence.setItem(STORE_KEY, JSON.stringify(_state));
        notify();
        return true;
      } catch {
        const msg = 'Local storage is full or blocked. Export your data now (Home → Export).';
        if (options.onQuotaError) options.onQuotaError(msg);
        return false;
      }
    },

    get(): SentinelState {
      return store.load();
    },

    /* ---- committed run (baseline) ---- */
    commitRun(run: Run): void {
      const s = store.load();
      s.committedRun = run;
      s.runHistory.unshift({
        weekEnding: run.weekEnding,
        committedAt: run.committedAt,
        deviceCount: run.rows.length,
        avgCRS: run.summary.avgCRS,
        avgDEX: run.summary.avgDEX,
        critical: run.summary.tierCounts.CRITICAL || 0,
        high: run.summary.tierCounts.HIGH || 0,
        hriWatch: run.summary.hriWatch,
        hidden: run.summary.hidden,
      });
      s.runHistory = s.runHistory.slice(0, 52);
      store.save();
      const queued = run.rows
        .filter((r) => r.queue && !r.excluded)
        .map((r) => r.name as string);
      store.carryForwardQueue(run, queued);
    },

    currentRun(): Run | null {
      return store.load().committedRun;
    },

    /* ---- overlay: findings on top of the frozen baseline ----
       The baseline row is NEVER written. Findings live in run.overlay and
       every field change is journalled to the changelog. */
    applyFinding(device: string, changes: Record<string, unknown>, source: string): boolean {
      const s = store.load();
      const run = s.committedRun;
      if (!run) return false;
      if (!run.overlay) run.overlay = {};
      const baseRow: Device = run.rows.find((r) => r.name === device) || {};
      const ov = run.overlay[device] || {};
      const stamp = new Date().toISOString();
      for (const field in changes) {
        const val = changes[field];
        if (field === 'state') {
          setStateInternal(s, device, val, source, stamp);
          continue;
        }
        const oldVal = field in ov ? ov[field] : (baseRow[field] ?? null);
        if (String(oldVal ?? '') === String(val ?? '')) continue;
        ov[field] = val;
        s.changelog.unshift({ device, field, old: oldVal, new: val, source, ts: stamp });
      }
      run.overlay[device] = ov;
      store.save();
      return true;
    },

    getOverlay(device: string): Record<string, unknown> {
      const run = store.load().committedRun;
      return (run && run.overlay && run.overlay[device]) || {};
    },

    eff(row: Device, field: string): unknown {
      const ov = store.getOverlay(row.name as string);
      return field in ov ? ov[field] : row[field];
    },

    getChangelog() {
      return store.load().changelog;
    },

    clearChangelog(): void {
      const s = store.load();
      s.changelog = [];
      store.save();
    },

    logHandoff(direction, platform, summary, count): void {
      const s = store.load();
      s.handoffLog.unshift({
        direction,
        platform,
        summary,
        count: count ?? null,
        week: store.currentRun()?.weekEnding || null,
        ts: new Date().toISOString(),
      });
      s.handoffLog = s.handoffLog.slice(0, 200);
      store.save();
    },

    getHandoffLog() {
      return store.load().handoffLog;
    },

    savePhaseNote(phase, text): void {
      const run = store.load().committedRun;
      if (!run) return;
      if (!run.investigation) run.investigation = { phaseNotes: {}, updated: null };
      run.investigation.phaseNotes[String(phase)] = text;
      run.investigation.updated = new Date().toISOString();
      store.save();
    },

    getPhaseNote(phase): string {
      const run = store.load().committedRun;
      return run?.investigation?.phaseNotes?.[String(phase)] || '';
    },

    setWork(device, state, note): void {
      const s = store.load();
      s.workState[device] = {
        state,
        note: note != null ? note : s.workState[device]?.note || '',
        updated: new Date().toISOString(),
      };
      store.save();
    },

    getWork(device): WorkEntry {
      return store.load().workState[device] || { state: 'notstarted', note: '', updated: null };
    },

    setDeviceState(device, rawVal, source): void {
      const s = store.load();
      setStateInternal(s, device, rawVal, source || 'manual', new Date().toISOString());
      store.save();
    },

    getQueue(device): QueueMeta {
      return (
        store.load().queueMeta[device] || {
          state: 'NEW',
          assignee: '',
          ticketId: '',
          consecutiveWeeks: 0,
          firstWeek: null,
          lastWeek: null,
          deferReason: '',
          revisitDate: '',
          history: [],
        }
      );
    },

    setQueueField(device, field, val, source): void {
      const s = store.load();
      const qm = s.queueMeta[device] || store.getQueue(device);
      const old = qm[field];
      if (String(old ?? '') === String(val ?? '')) return;
      qm[field] = val;
      s.queueMeta[device] = qm;
      // PRESERVED QUIRK (B-07): `old||'—'` turns a falsy-but-real old value
      // (0, '') into an em dash in the journal.
      s.changelog.unshift({
        device,
        field,
        old: (old as string) || '—',
        new: val,
        source: source || 'manual',
        ts: new Date().toISOString(),
      });
      store.save();
    },

    carryForwardQueue(run: Run, queuedNames: string[]): void {
      const s = store.load();
      const wk = run.weekEnding;
      queuedNames.forEach((name) => {
        const qm = s.queueMeta[name];
        if (!qm) {
          s.queueMeta[name] = {
            state: 'NEW',
            assignee: '',
            ticketId: '',
            consecutiveWeeks: 1,
            firstWeek: wk,
            lastWeek: wk,
            deferReason: '',
            revisitDate: '',
            history: [],
            recurred: false,
          };
        } else if (qm.lastWeek !== wk) {
          if (isClosedState(qm.state)) {
            qm.state = 'NEW';
            qm.recurred = true;
            qm.consecutiveWeeks = 1;
            qm.firstWeek = wk;
            qm.history.unshift({
              state: 'RECURRED',
              source: 'carry-forward',
              ts: new Date().toISOString(),
            });
          } else {
            qm.consecutiveWeeks = (qm.consecutiveWeeks || 0) + 1;
          }
          qm.lastWeek = wk;
        }
      });
      store.save();
    },

    /* ---- config ---- */
    getConfig(): StoredConfig | null {
      return store.load().config;
    },
    setConfig(cfg: StoredConfig): void {
      const s = store.load();
      s.config = cfg;
      store.save();
    },
    resetConfig(): void {
      const s = store.load();
      s.config = null;
      store.save();
    },

    /* ---- validation ledger ---- */
    addOutcome(o: OutcomeInput): void {
      const s = store.load();
      s.outcomes.unshift({
        device: o.device,
        week: o.week || store.currentRun()?.weekEnding || null,
        predictedSev: o.predictedSev ?? null,
        predictedTier: o.predictedTier ?? null,
        hri: o.hri ?? null,
        crs: o.crs ?? null,
        outcome: o.outcome,
        component: o.component || '',
        leadDays: o.leadDays ?? null,
        note: o.note || '',
        ts: new Date().toISOString(),
      });
      store.save();
    },
    getOutcomes() {
      return store.load().outcomes;
    },
    removeOutcome(idx: number): void {
      const s = store.load();
      s.outcomes.splice(idx, 1);
      store.save();
    },

    /* ---- tuning guard: one change per 60-day window ---- */
    getLastTuning() {
      return store.load().lastTuning;
    },
    recordTuning(change: unknown): void {
      const s = store.load();
      s.lastTuning = { ts: new Date().toISOString(), change };
      store.save();
    },
    tuningAllowed(): { allowed: boolean; daysLeft: number } {
      const lt = store.load().lastTuning;
      if (!lt) return { allowed: true, daysLeft: 0 };
      const days = (Date.now() - new Date(lt.ts).getTime()) / 86400000;
      return { allowed: days >= 60, daysLeft: Math.max(0, Math.ceil(60 - days)) };
    },

    exportBlob(): string {
      return JSON.stringify(store.load(), null, 2);
    },
    importBlob(text: string): void {
      const obj = JSON.parse(text) as SentinelState;
      if (!obj.schemaVersion) throw new Error('not a Sentinel export');
      _state = obj;
      store.save();
    },
    reset(): void {
      _state = blankState();
      store.save();
    },
  };

  /* ---- unified device-state setter (queue + 3-state + history) ----
     Private in the original (`Store._setState`); kept private here. */
  function setStateInternal(
    s: SentinelState,
    device: string,
    rawVal: unknown,
    source: string,
    stamp: string,
  ): { prevRaw: string; raw: string; ws: WorkState } {
    const raw = normState(rawVal);
    const ws = mapStateToWork(raw);
    const qm: QueueMeta = s.queueMeta[device] || {
      state: 'NEW',
      assignee: '',
      ticketId: '',
      consecutiveWeeks: 0,
      firstWeek: null,
      lastWeek: null,
      deferReason: '',
      revisitDate: '',
      history: [],
    };
    const prevRaw = qm.state;
    if (prevRaw !== raw) {
      s.changelog.unshift({ device, field: 'state', old: prevRaw, new: raw, source, ts: stamp });
      qm.history.unshift({ state: raw, source, ts: stamp });
      qm.history = qm.history.slice(0, 40);
    }
    qm.state = raw as QueueMeta['state'];
    s.queueMeta[device] = qm;
    s.workState[device] = {
      state: ws,
      note: s.workState[device]?.note || '',
      updated: stamp,
      raw: raw as QueueMeta['state'],
    };
    return { prevRaw, raw, ws };
  }

  return store;
}

/* ============================================================
   store-compat.test.ts — the storage contract.

   Operators have real data under localStorage key `sentinel.v1`. The
   store must read an existing blob as-is, keep writing the bare blob
   (schemaVersion at the top level, no wrapper) that the original
   console's importBlob() accepts, and expose the same
   exportBlob()/importBlob() format.
   ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, STORE_KEY, blankState } from '@/core/store-core';
import { makeCfg } from '@/core/scoring';
import { buildRun } from '@/core/pipeline';
import { applyStoredConfig } from '@/core/config';
import {
  createLegacyPersistStorage,
  createPersistence,
  createRawBlobIO,
} from '@/store/legacy-storage';
import { sampleFile } from '@/test/fixtures';
import type { SentinelState } from '@/core/types';

/* ---------- a localStorage stand-in shared by both sides ---------- */
function fakeStorage(seed?: Record<string, string>) {
  const d = new Map<string, string>(Object.entries(seed || {}));
  return {
    d,
    getItem: (k: string) => d.get(k) ?? null,
    setItem: (k: string, v: string) => void d.set(k, v),
    removeItem: (k: string) => void d.delete(k),
  };
}

/** A realistic blob, shaped exactly as the original console wrote it. */
function legacyBlob(): SentinelState {
  const cfg = makeCfg();
  const { run } = buildRun('2026-08-07', [sampleFile()], cfg, null);
  const s = blankState();
  s.committedRun = run;
  s.runHistory = [
    {
      weekEnding: run.weekEnding,
      committedAt: run.committedAt,
      deviceCount: run.rows.length,
      avgCRS: run.summary.avgCRS,
      avgDEX: run.summary.avgDEX,
      critical: run.summary.tierCounts.CRITICAL,
      high: run.summary.tierCounts.HIGH,
      hriWatch: run.summary.hriWatch,
      hidden: run.summary.hidden,
    },
  ];
  s.changelog = [
    {
      device: 'DEMO-LT-0007',
      field: 'component',
      old: null,
      new: 'RAM',
      source: 'copilot',
      ts: '2026-08-08T10:00:00.000Z',
    },
  ];
  s.queueMeta = {
    'DEMO-LT-0007': {
      state: 'ACTIONED',
      assignee: 'user0042',
      ticketId: 'INC0042',
      consecutiveWeeks: 3,
      firstWeek: '2026-07-24',
      lastWeek: '2026-08-07',
      deferReason: '',
      revisitDate: '',
      history: [{ state: 'ACTIONED', source: 'queue', ts: '2026-08-07T09:00:00.000Z' }],
    },
  };
  s.workState = {
    'DEMO-LT-0007': { state: 'inprogress', note: 'RMA raised', updated: '2026-08-07T09:00:00.000Z' },
  };
  s.config = {
    crsW: { dex: 20, crash: 20, age: 15, ram: 10, storage: 15, os: 10, avail: 10 },
    crsTier: { CRITICAL: 45, HIGH: 33, ELEVATED: 22, MONITOR: 11 },
    hriBand: { FAILING: 40, DEGRADING: 20, WATCH: 8 },
    excludeSrc: ['^svc', '^ZZ-'],
  };
  s.outcomes = [
    {
      device: 'DEMO-LT-0007',
      week: '2026-08-07',
      predictedSev: 'FAILING',
      predictedTier: 'HIGH',
      hri: 54,
      crs: 41.2,
      outcome: 'confirmed_fail',
      component: 'SSD',
      leadDays: 6,
      note: '',
      ts: '2026-08-08T10:00:00.000Z',
    },
  ];
  s.lastTuning = { ts: '2026-06-01T00:00:00.000Z', change: 'Raise HRI WATCH 8 -> 10' };
  s.handoffLog = [
    {
      direction: 'out',
      platform: 'copilot',
      summary: 'package exported',
      count: 12,
      week: '2026-08-07',
      ts: '2026-08-07T12:00:00.000Z',
    },
  ];
  s.updated = '2026-08-08T10:00:00.000Z';
  return s;
}

describe('storage contract: reading an existing sentinel.v1 blob', () => {
  let seeded: ReturnType<typeof fakeStorage>;
  let blob: SentinelState;

  beforeEach(() => {
    blob = legacyBlob();
    seeded = fakeStorage({ [STORE_KEY]: JSON.stringify(blob) });
  });

  it('boots straight onto the legacy blob with no migration', () => {
    const io = createRawBlobIO(seeded);
    const store = createStore(createPersistence(io));
    const s = store.load();
    expect(s.schemaVersion).toBe(1);
    expect(s.committedRun?.weekEnding).toBe('2026-08-07');
    expect(s.committedRun?.rows.length).toBe(300);
  });

  it('reads the same committed run back, device for device', () => {
    const io = createRawBlobIO(seeded);
    const store = createStore(createPersistence(io));
    const run = store.currentRun()!;
    expect(run.rows.map((r) => r.name)).toEqual(blob.committedRun!.rows.map((r) => r.name));
    expect(run.summary).toEqual(blob.committedRun!.summary);
    expect(run.report.hriMode).toBe('counts');
  });

  it('preserves every legacy sub-structure: queue meta, work, changelog, outcomes, tuning', () => {
    const io = createRawBlobIO(seeded);
    const store = createStore(createPersistence(io));
    expect(store.getQueue('DEMO-LT-0007').consecutiveWeeks).toBe(3);
    expect(store.getQueue('DEMO-LT-0007').ticketId).toBe('INC0042');
    expect(store.getWork('DEMO-LT-0007').note).toBe('RMA raised');
    expect(store.getChangelog()).toHaveLength(1);
    expect(store.getOutcomes()).toHaveLength(1);
    expect(store.getLastTuning()?.change).toBe('Raise HRI WATCH 8 -> 10');
    expect(store.getHandoffLog()).toHaveLength(1);
  });

  it('applies the stored config at boot, including custom exclude patterns', () => {
    const io = createRawBlobIO(seeded);
    const store = createStore(createPersistence(io));
    const cfg = makeCfg();
    applyStoredConfig(cfg, store);
    expect(cfg.crsTier.CRITICAL).toBe(45);
    expect(cfg.excludePatterns.map((r) => r.source)).toEqual(['^svc', '^ZZ-']);
  });

  it('an unknown extra key added by a future version survives a round trip', () => {
    const withExtra = { ...blob, futureField: { hello: 'world' } };
    const io = createRawBlobIO(fakeStorage({ [STORE_KEY]: JSON.stringify(withExtra) }));
    const store = createStore(createPersistence(io));
    store.setDeviceState('DEMO-LT-0007', 'RESOLVED', 'test');
    expect((store.load() as Record<string, unknown>).futureField).toEqual({ hello: 'world' });
  });
});

describe('storage contract: what we write', () => {
  it('writes the bare legacy blob under sentinel.v1 — no {state,version} wrapper', () => {
    const backing = fakeStorage();
    const io = createRawBlobIO(backing);
    const store = createStore(createPersistence(io));
    const cfg = makeCfg();
    const { run } = buildRun('2026-09-04', [sampleFile()], cfg, null);
    store.commitRun(run);

    const raw = backing.getItem(STORE_KEY)!;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed).not.toHaveProperty('state');
    expect(parsed).not.toHaveProperty('version');
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'changelog',
        'committedRun',
        'config',
        'handoffLog',
        'lastTuning',
        'outcomes',
        'queueMeta',
        'runHistory',
        'schemaVersion',
        'updated',
        'workState',
      ].sort(),
    );
  });

  it('exportBlob() -> importBlob() round-trips the run, queue state and config', () => {
    const store = createStore(createPersistence(createRawBlobIO(fakeStorage())));
    const cfg = makeCfg();
    store.commitRun(buildRun('2026-09-04', [sampleFile()], cfg, null).run);
    store.setDeviceState('DEMO-LT-0007', 'ACTIONED', 'queue');
    store.setConfig({ crsTier: { CRITICAL: 44, HIGH: 33, ELEVATED: 22, MONITOR: 11 } });
    const exported = store.exportBlob();

    const fresh = createStore(createPersistence(createRawBlobIO(fakeStorage())));
    fresh.importBlob(exported);
    expect(fresh.currentRun()?.weekEnding).toBe('2026-09-04');
    expect(fresh.currentRun()?.rows.length).toBe(300);
    expect(fresh.getQueue('DEMO-LT-0007').state).toBe('ACTIONED');
    expect((fresh.getConfig() as { crsTier: { CRITICAL: number } }).crsTier.CRITICAL).toBe(44);
  });

  it('rejects a non-Sentinel blob the same way the old app does', () => {
    const store = createStore(createPersistence(createRawBlobIO(fakeStorage())));
    expect(() => store.importBlob('{"hello":"world"}')).toThrow(/not a Sentinel export/);
  });
});

describe('storage contract: the zustand persist adapter', () => {
  it('unwraps on write so the on-disk shape stays the legacy blob', () => {
    const backing = fakeStorage();
    const io = createRawBlobIO(backing);
    const adapter = createLegacyPersistStorage(io);
    const blob = legacyBlob();

    adapter.setItem('sentinel.v1', { state: { blob }, version: 1 });

    const raw = backing.getItem(STORE_KEY)!;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed).not.toHaveProperty('state');
    expect(JSON.parse(raw)).toEqual(JSON.parse(JSON.stringify(blob)));
  });

  it('re-wraps on read, taking `version` from the blob’s own schemaVersion', async () => {
    const blob = legacyBlob();
    const io = createRawBlobIO(fakeStorage({ [STORE_KEY]: JSON.stringify(blob) }));
    const adapter = createLegacyPersistStorage(io);
    const value = await adapter.getItem('sentinel.v1');
    expect(value).not.toBeNull();
    expect(value!.version).toBe(1);
    expect(value!.state.blob.committedRun?.rows.length).toBe(300);
  });

  it('treats junk and non-Sentinel JSON as "nothing stored" rather than throwing', async () => {
    const junk = createLegacyPersistStorage(createRawBlobIO(fakeStorage({ [STORE_KEY]: 'not json' })));
    expect(await junk.getItem('sentinel.v1')).toBeNull();
    const foreign = createLegacyPersistStorage(
      createRawBlobIO(fakeStorage({ [STORE_KEY]: '{"hello":"world"}' })),
    );
    expect(await foreign.getItem('sentinel.v1')).toBeNull();
  });
});

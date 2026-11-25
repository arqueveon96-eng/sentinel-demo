/* ============================================================
   trends.ts — NEW in Phase 3. Pure shaping of committed runs into
   the series the Trends charts and the Fleet deltas read.

   WHY THIS MODULE EXISTS, AND WHY IT ADDS A KEY TO THE BLOB
   ---------------------------------------------------------
   `store.commitRun()` writes one `runHistory` entry per commit, and that
   entry carries only: weekEnding, committedAt, deviceCount, avgCRS,
   avgDEX, critical, high, hriWatch, hidden.

   That is enough for the DEX line, the CRS line and the hidden-risk
   line. It is NOT enough for either of the other two things Phase 3
   asks for:

     - a CRITICAL -> HEALTHY stacked bar (ELEVATED / MONITOR / HEALTHY
       are not in the entry at all), and
     - "what this run changed" by HRI band (FAILING / DEGRADING / WATCH
       / STABLE are not in the entry either).

   `commitRun` lives in src/core/store-core.ts and this phase does not
   edit ported modules. So the app writes an ADDITIVE top-level key,
   `runMeta`, alongside the eleven legacy keys, holding the full
   composition per committed week. Reads in store-core are additive by
   construction (`load()` JSON.parses the blob and uses it outright), so
   the key survives a round trip and the legacy console ignores it —
   there is a test for exactly that behaviour in store-compat.test.ts.

   Weeks committed before this key existed (or by the original console)
   simply have no `runMeta` entry. `trendPoints` marks those points
   `full: false` and every consumer must say so rather than draw a
   composition it does not have. NEVER A FABRICATED NUMBER applies here
   more than anywhere else in the product.

   Pure: no React, no DOM, no I/O. Same species as reports.ts.
   ============================================================ */

import type { Run, RunHistoryEntry, SentinelState, Summary, Tier } from './types';

export const TIER_ORDER: Tier[] = ['CRITICAL', 'HIGH', 'ELEVATED', 'MONITOR', 'HEALTHY'];
export type Band = 'FAILING' | 'DEGRADING' | 'WATCH' | 'STABLE';
export const BAND_ORDER: Band[] = ['FAILING', 'DEGRADING', 'WATCH', 'STABLE'];

/** The additive per-week record. Everything here is copied from `run.summary`. */
export interface RunMeta {
  weekEnding: string;
  committedAt: string;
  inScope: number;
  excluded: number;
  avgDEX: number | null;
  avgCRS: number;
  tierCounts: Record<Tier, number>;
  sevCounts: Record<Band, number>;
  hidden: number;
  hriWatch: number;
  hriAvail: number;
}

export function makeRunMeta(run: Run): RunMeta {
  const s: Summary = run.summary;
  return {
    weekEnding: run.weekEnding,
    committedAt: run.committedAt,
    inScope: s.inScope,
    excluded: s.excluded,
    avgDEX: s.avgDEX,
    avgCRS: s.avgCRS,
    tierCounts: { ...s.tierCounts },
    sevCounts: { ...s.sevCounts },
    hidden: s.hidden,
    hriWatch: s.hriWatch,
    hriAvail: s.hriAvail,
  };
}

/** Reads the additive key defensively — anything malformed reads as absent. */
export function readRunMeta(state: SentinelState | null | undefined): RunMeta[] {
  const raw = (state as Record<string, unknown> | null | undefined)?.runMeta;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is RunMeta =>
      !!m && typeof m === 'object' && typeof (m as RunMeta).weekEnding === 'string',
  );
}

/**
 * One record per week. A re-commit of the same week replaces its record,
 * matching how the operator thinks about the store: the week is the key.
 * Capped at 52 like `runHistory`.
 */
export function mergeRunMeta(list: RunMeta[], rec: RunMeta): RunMeta[] {
  return [rec, ...list.filter((m) => m.weekEnding !== rec.weekEnding)].slice(0, 52);
}

/** One committed week, as the charts read it. */
export interface TrendPoint {
  week: string;
  committedAt: string;
  devices: number;
  avgDEX: number | null;
  avgCRS: number;
  critical: number;
  high: number;
  /** exact: devices - critical - high. Always known, never a guess. */
  rest: number;
  hidden: number;
  hriWatch: number;
  /** null unless this week has a full record — never inferred */
  elevated: number | null;
  monitor: number | null;
  healthy: number | null;
  failing: number | null;
  degrading: number | null;
  watch: number | null;
  stable: number | null;
  excluded: number | null;
  /** true when the tier and band composition for this week is really recorded */
  full: boolean;
}

/**
 * Chronological, one point per committed week, oldest first.
 * `runHistory` is newest-first (the store `unshift`s) and can hold two
 * entries for one week if it was committed twice; the later commit wins.
 */
export function trendPoints(
  history: RunHistoryEntry[] | null | undefined,
  meta: RunMeta[] | null | undefined,
): TrendPoint[] {
  const byWeek = new Map<string, RunHistoryEntry>();
  (history || []).forEach((h) => {
    if (!h || typeof h.weekEnding !== 'string') return;
    const prev = byWeek.get(h.weekEnding);
    if (!prev || String(h.committedAt) > String(prev.committedAt)) byWeek.set(h.weekEnding, h);
  });
  const metaByWeek = new Map<string, RunMeta>();
  (meta || []).forEach((m) => {
    const prev = metaByWeek.get(m.weekEnding);
    if (!prev || String(m.committedAt) > String(prev.committedAt)) metaByWeek.set(m.weekEnding, m);
  });

  return [...byWeek.values()]
    .sort((a, b) => (a.weekEnding < b.weekEnding ? -1 : a.weekEnding > b.weekEnding ? 1 : 0))
    .map((h) => {
      const m = metaByWeek.get(h.weekEnding) ?? null;
      const devices = m ? m.inScope : h.deviceCount;
      const critical = m ? m.tierCounts.CRITICAL : h.critical;
      const high = m ? m.tierCounts.HIGH : h.high;
      return {
        week: h.weekEnding,
        committedAt: h.committedAt,
        devices,
        avgDEX: m ? m.avgDEX : h.avgDEX,
        avgCRS: m ? m.avgCRS : h.avgCRS,
        critical,
        high,
        rest: Math.max(0, devices - critical - high),
        hidden: m ? m.hidden : h.hidden,
        hriWatch: m ? m.hriWatch : h.hriWatch,
        elevated: m ? m.tierCounts.ELEVATED : null,
        monitor: m ? m.tierCounts.MONITOR : null,
        healthy: m ? m.tierCounts.HEALTHY : null,
        failing: m ? m.sevCounts.FAILING : null,
        degrading: m ? m.sevCounts.DEGRADING : null,
        watch: m ? m.sevCounts.WATCH : null,
        stable: m ? m.sevCounts.STABLE : null,
        excluded: m ? m.excluded : null,
        full: !!m,
      };
    });
}

/** A line needs two points. One committed week is a dot and a sentence. */
export function hasTrend(points: TrendPoint[]): boolean {
  return points.length >= 2;
}

/** Every week's composition is fully recorded, so a five-tier stack is honest. */
export function allFull(points: TrendPoint[]): boolean {
  return points.length > 0 && points.every((p) => p.full);
}

/* ---------- deltas: what this run changed ---------- */

export interface DeltaRow {
  label: string;
  prev: number | null;
  cur: number | null;
  /** null when the prior week did not record this figure */
  delta: number | null;
  /** true when a rise is bad (CRITICAL up is worse); false for avg DEX */
  riseIsWorse: boolean;
}

function row(label: string, prev: number | null, cur: number | null, riseIsWorse = true): DeltaRow {
  const delta = prev == null || cur == null ? null : +(cur - prev).toFixed(1);
  return { label, prev, cur, delta, riseIsWorse };
}

/**
 * Tier deltas, band deltas and the two averages between two committed
 * weeks. A figure the prior week never recorded comes back with
 * `delta: null` — the view says "not recorded for that week" rather than
 * printing a difference against a number that does not exist.
 */
export function deltaRows(prev: TrendPoint, cur: TrendPoint): {
  tiers: DeltaRow[];
  bands: DeltaRow[];
  fleet: DeltaRow[];
} {
  return {
    tiers: [
      row('CRITICAL', prev.critical, cur.critical),
      row('HIGH', prev.high, cur.high),
      row('ELEVATED', prev.elevated, cur.elevated),
      row('MONITOR', prev.monitor, cur.monitor),
      row('HEALTHY', prev.healthy, cur.healthy, false),
    ],
    bands: [
      row('FAILING', prev.failing, cur.failing),
      row('DEGRADING', prev.degrading, cur.degrading),
      row('WATCH', prev.watch, cur.watch),
      row('STABLE', prev.stable, cur.stable, false),
    ],
    fleet: [
      row('Hidden risk', prev.hidden, cur.hidden),
      row('HRI watchlist', prev.hriWatch, cur.hriWatch),
      row('Avg composite CRS', prev.avgCRS, cur.avgCRS),
      row('Avg DEX', prev.avgDEX, cur.avgDEX, false),
      row('Devices in scope', prev.devices, cur.devices, false),
    ],
  };
}

/** `+3` / `−2` / `no change`. A true minus sign, not a hyphen. */
export function fmtDelta(d: number | null): string {
  if (d == null) return 'not recorded';
  if (d === 0) return 'no change';
  return d > 0 ? `+${d}` : `−${Math.abs(d)}`;
}

/** 'better' | 'worse' | 'same' | 'unknown' — for the colour, never for the number. */
export function deltaTone(r: DeltaRow): 'better' | 'worse' | 'same' | 'unknown' {
  if (r.delta == null) return 'unknown';
  if (r.delta === 0) return 'same';
  const up = r.delta > 0;
  return up === r.riseIsWorse ? 'worse' : 'better';
}

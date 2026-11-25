/* ============================================================
   hristar.ts — the LOGIC HALF of js/hristar.js, and nothing else.

   THE CALL (port only what holds logic rather than rendering):
   hristar.js holds BOTH. Sections 1-2 and 4 are scoring logic (band config,
   the HRI* curves, an ingest alias for `burst_flag_`). Sections 3 and 5-7
   are runtime monkey-patches of `window.scoreDevice`, `renderScore`,
   `renderConfig` and `saveConfig` — pure DOM rendering and global
   reassignment that have no place in a React app.

   So: the curves are ported here as pure functions. The monkey-patching is
   NOT ported, and — critically — `computeStar` is NOT wired into the
   pipeline. In the vanilla app the add-on is an optional <script> tag that
   the regression suite never loads, so a committed run's HRI/CRS/tier/queue
   fields are identical with or without it. Keeping it opt-in here preserves
   that. Phase 2 decides whether to surface the parallel track in the UI.

   Design guarantee (from the original header): HRI* >= HRI on every device.
   HRI* NEVER drives dispatch.
   ============================================================ */

import type { Cfg, Device, HriBands, Sev, StoreApi } from './types';

export const HRI_STAR_DEFAULT_BANDS: HriBands = { FAILING: 40, DEGRADING: 20, WATCH: 8 };

/** Section 1: bands are config-backed and mirror HRI by default. */
export function ensureStarBands(cfg: Cfg, store: StoreApi): HriBands {
  cfg.hriStarBand = cfg.hriStarBand || { ...HRI_STAR_DEFAULT_BANDS };
  const savedStar = (store.getConfig() || {}).hriStarBand;
  if (savedStar) cfg.hriStarBand = { ...cfg.hriStarBand, ...savedStar } as HriBands;
  return cfg.hriStarBand;
}

// Reset + crash curves are IDENTICAL to production (scoring.ts) so HRI* is never weaker.
export function starReset(n: number | null | undefined): number {
  if (n == null) return 0;
  return n >= 10 ? 40 : n >= 5 ? 33 : n >= 3 ? 26 : n >= 2 ? 21 : n >= 1 ? 16 : 0;
}
export function starCrash(n: number | null | undefined): number {
  if (n == null) return 0;
  return n >= 5 ? 40 : n >= 3 ? 33 : n >= 2 ? 28 : n >= 1 ? 18 : 0;
}
// Fuller uptime-creep curve (production uses a binary >14 -> 5). Ungated.
export function starSoft(b: number | null | undefined): number {
  if (b == null) return 0;
  return b > 30 ? 10 : b > 14 ? 6 : b > 7 ? 3 : 0;
}

/** Mutates `d` in place, exactly like the original `computeStar`. */
export function computeStar(d: Device, cfg: Cfg): Device {
  const haveReset = d.hardResets != null;
  const haveCrash = d.crashCount != null;
  // Same existence rule as HRI, so agreement is apples-to-apples.
  if (!haveReset && !haveCrash) {
    d.hriStar = null;
    d.sevStar = '—';
    d.burst = false;
    d.hriAgree = '—';
    d.hriStarParts = null;
    return d;
  }
  let rp = starReset(d.hardResets);
  const cp = starCrash(d.crashCount);
  const sp = starSoft(d.boot);
  let burst = false;
  // Optional override: reset cluster within <=60min, observed in a P7 deep-dive.
  // Not derivable from 30-day totals — set via an ingested `burst_flag_` column.
  if (d.burstFlag) {
    rp = 40;
    burst = true;
  }
  const v = Math.min(100, rp + cp + sp);
  const B = cfg.hriStarBand || HRI_STAR_DEFAULT_BANDS;
  d.hriStar = v;
  d.burst = burst;
  d.hriStarParts = { reset: rp, crash: cp, soft: sp, burst };
  d.sevStar = (
    v >= B.FAILING ? 'FAILING' : v >= B.DEGRADING ? 'DEGRADING' : v >= B.WATCH ? 'WATCH' : 'STABLE'
  ) as Sev;
  d.hriAgree = d.sev === '—' ? '—' : d.sev === d.sevStar ? 'MATCH' : 'DIVERGE';
  return d;
}

/** Section 4: the optional ingest alias, as data rather than a SCHEMA_MAP mutation. */
export const BURST_FLAG_ALIASES = ['burst_flag_', 'reset_cluster_flag_'] as const;

export function readBurstFlag(raw: unknown): boolean {
  const v = String(raw || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

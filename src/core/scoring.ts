/* ============================================================
   scoring.ts — port of js/scoring.js. Deterministic. NO AI, NO INFERENCE.
   Three models, never merged:
     Composite CRS (absolute), Triage rank (relative), HRI (counts, provisional).
   Every band lives in the Cfg object handed in (legacy: the CFG global).

   PORT NOTE: behaviour is frozen. Numbers, band edges, comparison operators,
   iteration order and in-place mutation of the device object are identical to
   the original. The only change is that `CFG` is an explicit parameter.
   ============================================================ */

import type {
  Ceiling,
  Cfg,
  CrsPoints,
  Device,
  HriMode,
  Sev,
  Summary,
  Tier,
  WeightedContribution,
} from './types';

/** Legacy CFG literal from scoring.js. `makeCfg()` returns a fresh mutable copy. */
export function makeCfg(): Cfg {
  return {
    crsW: { dex: 20, crash: 20, age: 15, ram: 10, storage: 15, os: 10, avail: 10 },
    crsTier: { CRITICAL: 52, HIGH: 38, ELEVATED: 25, MONITOR: 12 },
    hriBand: { FAILING: 40, DEGRADING: 20, WATCH: 8 },
    excludePatterns: [/^svc/i, /admin$/i, /^shared-/i, /^kiosk-/i, /service account/i],
  };
}

export function num(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/^"|"$/g, '').replace(/,/g, '');
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function memGB(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return n > 1e6 ? n / (1024 * 1024 * 1024) : n; // bytes -> GB, else already GB
}

export function isExcluded(user: string | null | undefined, cfg: Cfg): boolean {
  if (!user) return false;
  return cfg.excludePatterns.some((re) => re.test(user));
}

export function crsPoints(d: Device, cfg: Cfg): CrsPoints {
  const p = {} as CrsPoints;
  // null = unknown, not 0 — the guardrail. A null DEX must never sort as healthy.
  p.dex = d.dex == null ? 40 : d.dex <= 30 ? 100 : d.dex <= 70 ? 50 : 0;
  const c = d.crashes;
  // >=500 anti-saturation: a 6887-crash device separates from a 101-crash one.
  p.crash =
    c == null ? 0 : c >= 500 ? 100 : c >= 100 ? 85 : c >= 50 ? 70 : c >= 20 ? 50 : c >= 5 ? 25 : 0;
  p.age = d.age == null ? 0 : d.age > 1095 ? 100 : d.age > 730 ? 65 : d.age > 365 ? 30 : 0;
  p.ram = d.ramGB == null ? 0 : d.ramGB <= 8 ? 100 : d.ramGB <= 16 ? 50 : 0;
  p.storage = d.free == null ? 0 : d.free < 20 ? 100 : d.free < 50 ? 60 : d.free < 100 ? 20 : 0;
  const os = (d.os || '').toUpperCase();
  // matches "WINDOWS 10", never a bare "10" (which would hit "Windows 11 ... 10..." strings)
  p.os =
    os.includes('WINDOWS 10') || os.includes('PREVIEW')
      ? 100
      : os.includes('22H2')
        ? 80
        : os.includes('23H2')
          ? 50
          : os.includes('24H2')
            ? 20
            : os.includes('25H2')
              ? 0
              : d.os
                ? 0
                : 40;
  p.avail = d.seen == null ? 0 : d.seen > 7 ? 100 : d.seen > 3 ? 60 : d.seen > 1 ? 20 : 0;
  // `cfg` is unused here in the original too — weights are applied in scoreDevice.
  void cfg;
  return p;
}

export function hriResetPoints(n: number | null | undefined): number {
  if (n == null) return 0;
  return n >= 10 ? 40 : n >= 5 ? 33 : n >= 3 ? 26 : n >= 2 ? 21 : n >= 1 ? 16 : 0;
}

export function hriCrashPoints(n: number | null | undefined): number {
  if (n == null) return 0;
  return n >= 5 ? 40 : n >= 3 ? 33 : n >= 2 ? 28 : n >= 1 ? 18 : 0;
}

export function hriSoftPoints(
  bootDays: number | null | undefined,
  hardSignalPresent: boolean,
): number {
  if (bootDays == null || !hardSignalPresent) return 0;
  return bootDays > 14 ? 5 : 0;
}

export interface HriResult {
  hri: number | null;
  sev: Sev;
  mode: HriMode;
  parts: { reset: number; crash: number; soft: number } | null;
}

export function hriCounts(d: Device, cfg: Cfg): HriResult {
  const haveReset = d.hardResets != null;
  const haveCrash = d.crashCount != null;
  if (!haveReset && !haveCrash) return { hri: null, sev: '—', mode: 'unavailable', parts: null };
  const rp = hriResetPoints(d.hardResets);
  const cp = hriCrashPoints(d.crashCount);
  const sp = hriSoftPoints(d.boot, rp + cp > 0);
  const hri = Math.min(100, rp + cp + sp);
  const B = cfg.hriBand;
  const sev: Sev =
    hri >= B.FAILING
      ? 'FAILING'
      : hri >= B.DEGRADING
        ? 'DEGRADING'
        : hri >= B.WATCH
          ? 'WATCH'
          : 'STABLE';
  return {
    hri,
    sev,
    // PRESERVED QUIRK: mode keys off hard resets only, so a resets-only file
    // still reports 'counts' while a crashes-only file reports 'counts-partial'.
    mode: haveReset ? 'counts' : 'counts-partial',
    parts: { reset: rp, crash: cp, soft: sp },
  };
}

/** Mutates `d` in place and returns it — same as the original. */
export function scoreDevice(d: Device, cfg: Cfg): Device {
  const p = crsPoints(d, cfg);
  d.pts = p;
  const W = cfg.crsW;
  d.crs =
    (p.dex * W.dex +
      p.crash * W.crash +
      p.age * W.age +
      p.ram * W.ram +
      p.storage * W.storage +
      p.os * W.os +
      p.avail * W.avail) /
    100;
  const wtd: WeightedContribution = {
    DEX: p.dex * W.dex,
    Crashes: p.crash * W.crash,
    Age: p.age * W.age,
    RAM: p.ram * W.ram,
    Storage: p.storage * W.storage,
    OS: p.os * W.os,
    Availability: p.avail * W.avail,
  };
  d.wtd = wtd;
  let best = '—';
  let bv = -1;
  for (const k in wtd) {
    if (wtd[k] > bv) {
      bv = wtd[k];
      best = k;
    }
  }
  d.driver = bv <= 0 ? '—' : best;
  const T = cfg.crsTier;
  const crs = d.crs;
  d.tier = (
    crs >= T.CRITICAL
      ? 'CRITICAL'
      : crs >= T.HIGH
        ? 'HIGH'
        : crs >= T.ELEVATED
          ? 'ELEVATED'
          : crs >= T.MONITOR
            ? 'MONITOR'
            : 'HEALTHY'
  ) as Tier;
  const h = hriCounts(d, cfg);
  d.hri = h.hri;
  d.sev = h.sev;
  d.hriMode = h.mode;
  d.hriParts = h.parts;
  d.excluded = isExcluded(d.user, cfg);
  // hidden risk: HRI flags it, the composite misses it.
  d.hidden = d.hri != null && d.hri >= cfg.hriBand.WATCH && d.tier !== 'CRITICAL' && d.tier !== 'HIGH';
  d.queue =
    !d.excluded &&
    (d.tier === 'CRITICAL' || d.tier === 'HIGH' || (d.hri != null && d.hri >= cfg.hriBand.WATCH));
  return d;
}

/**
 * Relative percentile rank. Deliberately a SEPARATE field from `tier` — a
 * triage rank is never presented as absolute risk.
 */
export function assignTriage(rows: Device[]): Device[] {
  const scored = rows
    .filter((r) => !r.excluded)
    .slice()
    .sort((a, b) => (b.crs as number) - (a.crs as number));
  const n = scored.length;
  scored.forEach((r, i) => {
    const pct = n <= 1 ? 1 : 1 - i / (n - 1);
    r.triage =
      pct >= 0.992
        ? 'CRITICAL'
        : pct >= 0.958
          ? 'HIGH'
          : pct >= 0.834
            ? 'ELEVATED'
            : pct >= 0.4
              ? 'MONITOR'
              : 'HEALTHY';
  });
  return rows;
}

export function ceilingDiagnostics(rows: Device[], cfg: Cfg): Ceiling {
  const W = cfg.crsW;
  const T = cfg.crsTier;
  let maxObserved = 0;
  let maxAttainable = 0;
  const dims = ['dex', 'crash', 'age', 'ram', 'storage', 'os', 'avail'] as const;
  const zero: Record<string, number> = {};
  dims.forEach((k) => (zero[k] = 0));
  rows.forEach((d) => {
    maxObserved = Math.max(maxObserved, d.crs as number);
    const p = d.pts as CrsPoints;
    const att =
      (100 * W.dex +
        100 * W.crash +
        p.age * W.age +
        p.ram * W.ram +
        p.storage * W.storage +
        p.os * W.os +
        p.avail * W.avail) /
      100;
    maxAttainable = Math.max(maxAttainable, att);
    dims.forEach((k) => {
      if (p[k] === 0) zero[k]++;
    });
  });
  const n = rows.length || 1;
  const inert: Record<string, boolean> = {};
  dims.forEach((k) => {
    inert[k] = zero[k] / n > 0.9;
  });
  return {
    maxObserved: +maxObserved.toFixed(1),
    maxAttainable: +maxAttainable.toFixed(1),
    blockingCeiling: maxAttainable < T.CRITICAL,
    zeroPct: Object.fromEntries(dims.map((k) => [k, +((100 * zero[k]) / n).toFixed(1)])),
    inert,
  };
}

export function summarize(rows: Device[], cfg: Cfg): Summary {
  const inScope = rows.filter((r) => !r.excluded);
  const tierCounts = {} as Record<Tier, number>;
  (['CRITICAL', 'HIGH', 'ELEVATED', 'MONITOR', 'HEALTHY'] as const).forEach(
    (t) => (tierCounts[t] = 0),
  );
  const sevCounts = {} as Record<'FAILING' | 'DEGRADING' | 'WATCH' | 'STABLE', number>;
  (['FAILING', 'DEGRADING', 'WATCH', 'STABLE'] as const).forEach((s) => (sevCounts[s] = 0));
  let dexSum = 0;
  let dexN = 0;
  let crsSum = 0;
  let hidden = 0;
  let hriWatch = 0;
  let hriAvail = 0;
  inScope.forEach((d) => {
    tierCounts[d.tier as Tier]++;
    if (d.sev !== '—') {
      sevCounts[d.sev as 'FAILING' | 'DEGRADING' | 'WATCH' | 'STABLE']++;
      hriAvail++;
    }
    if (d.dex != null) {
      dexSum += d.dex;
      dexN++;
    }
    crsSum += d.crs as number;
    if (d.hidden) hidden++;
    if (d.hri != null && d.hri >= cfg.hriBand.WATCH) hriWatch++;
  });
  return {
    total: rows.length,
    inScope: inScope.length,
    excluded: rows.length - inScope.length,
    avgDEX: dexN ? +(dexSum / dexN).toFixed(1) : null,
    avgCRS: inScope.length ? +(crsSum / inScope.length).toFixed(1) : 0,
    tierCounts,
    sevCounts,
    hidden,
    hriWatch,
    hriAvail,
  };
}

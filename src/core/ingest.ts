/* ============================================================
   ingest.ts — port of js/ingest.js. Schema-adaptive CSV loader.
   Match columns BY NAME. Merge Query 1 (baseline) + Query 2 /
   Phase 4 (raw counts) on device name. Tolerate missing columns
   by flagging, never by silently scoring zero.

   PORT NOTE: the hand-rolled `parseCSV` is kept verbatim rather than
   swapped for papaparse — the character-by-character quoting and the
   trailing-row filter are load-bearing for parity. papaparse is used in
   the app shell only where the legacy parser is not on the path.
   `Store.currentRun()` becomes an explicit `prior` argument.
   ============================================================ */

import type { CoverageEntry, Device, Ingested, IngestReport, NullRates, PerFileReport, Run, SourceFile } from './types';
import { memGB, num } from './scoring';

/* canonical field -> accepted source aliases.
   NOTE: for HRI counts inputs, the canonical Phase 4 export names
   (total_hard_resets_, total_system_crashes_) are listed FIRST so
   resolveHeaders short-circuits on them before older aliases. */
export const SCHEMA_MAP: Record<string, string[]> = {
  name: ['device.name'],
  user: ['device.login.last_login_user_name', 'last_login_user_name'],
  model: ['device.hardware.model'],
  os: ['device.operating_system.name'],
  age: ['device.days_since_first_seen'],
  seen: ['device.days_since_last_seen'],
  boot: ['device.boot.days_since_last_full_boot'],
  memRaw: ['device.hardware.memory'],
  dex: ['dex_score_'],
  crashes: ['number_of_crashes_'], // CRS crash volume (NOT HRI)
  free: ['system_drive_free_space_gb_'],

  hrScore: ['hard_reset_score_'],
  relScore: ['device_reliability_score_'],
  scScore: ['system_crash_score_'],

  // HRI counts-mode inputs — canonical Phase 4 names FIRST
  hardResets: [
    'total_hard_resets_',
    'hard_resets_',
    'hard_reset_count_',
    'number_of_hard_resets_',
    'device.performance.hard_resets',
  ],
  crashCount: [
    'total_system_crashes_',
    'system_crashes_',
    'device.performance.system_crashes',
    'bsod_count_',
  ],

  // bugcheck: code and label are SEPARATE canonical fields so Phase 4
  // (which exports both as distinct columns) captures each, not just the first.
  bugcheckCode: ['last_bugcheck_code_', 'last_bugcheck_'],
  bugcheckLabel: ['last_bugcheck_label_'],
};

export const COLUMN_ROLES: { field: string; role: string; req: boolean }[] = [
  { field: 'name', role: 'device identity', req: true },
  { field: 'dex', role: 'CRS — DEX', req: true },
  { field: 'crashes', role: 'CRS — crash volume', req: false },
  { field: 'age', role: 'CRS — age', req: false },
  { field: 'memRaw', role: 'CRS — RAM', req: false },
  { field: 'free', role: 'CRS — storage', req: false },
  { field: 'os', role: 'CRS — OS currency', req: false },
  { field: 'seen', role: 'CRS — availability', req: false },
  { field: 'boot', role: 'HRI — uptime creep', req: false },
  { field: 'hardResets', role: 'HRI — hard resets', req: false },
  { field: 'crashCount', role: 'HRI — system crashes', req: false },
  { field: 'bugcheckCode', role: 'component attribution', req: false },
];

export function parseCSV(txt: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) {
      if (ch === '"') {
        if (txt[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') {
        row.push(cur);
        cur = '';
      } else if (ch === '\n') {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else if (ch === '\r') {
        /* skip */
      } else cur += ch;
    }
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

export function cleanHeader(h: string): string {
  return h.trim().replace(/^"|"$/g, '');
}

export function resolveHeaders(headers: string[]): Record<string, string> {
  const present: Record<string, string> = {};
  for (const canon in SCHEMA_MAP) {
    for (const alias of SCHEMA_MAP[canon]) {
      const hit = headers.find((h) => h.toLowerCase() === alias.toLowerCase());
      if (hit) {
        present[canon] = hit;
        break;
      } // first alias wins
    }
  }
  return present;
}

export function rawToDevice(
  obj: Record<string, string | undefined>,
  map: Record<string, string>,
): Device {
  const g = (c: string): string | undefined => (map[c] != null ? obj[map[c]] : undefined);
  return {
    name: (g('name') || '').trim(),
    user: (g('user') || '').trim(),
    model: (g('model') || '').trim(),
    os: (g('os') || '').trim(),
    age: num(g('age')),
    seen: num(g('seen')),
    boot: num(g('boot')),
    ramGB: memGB(g('memRaw')),
    dex: num(g('dex')),
    crashes: num(g('crashes')),
    free: num(g('free')),
    hrScore: num(g('hrScore')),
    relScore: num(g('relScore')),
    scScore: num(g('scScore')),
    hardResets: num(g('hardResets')),
    crashCount: num(g('crashCount')),
    bugcheckCode: (g('bugcheckCode') || '').trim() || null,
    bugcheckLabel: (g('bugcheckLabel') || '').trim() || null,
    // convenience: single display string preferring code
    lastBugcheck: (g('bugcheckCode') || g('bugcheckLabel') || '').trim() || null,
    _src: {},
  };
}

export function ingestFiles(files: SourceFile[]): Ingested {
  const perFile: PerFileReport[] = [];
  const merged = new Map<string, Device>();
  const allHeaders = new Set<string>();
  for (const f of files) {
    const rows = parseCSV(f.text);
    if (rows.length < 2) {
      perFile.push({ file: f.name, rows: 0, err: 'no data rows' });
      continue;
    }
    const headers = rows[0].map(cleanHeader);
    headers.forEach((h) => allHeaders.add(h));
    const map = resolveHeaders(headers);
    let count = 0;
    let rejected = 0;
    for (let i = 1; i < rows.length; i++) {
      const o: Record<string, string | undefined> = {};
      headers.forEach((h, j) => (o[h] = rows[i][j]));
      const d = rawToDevice(o, map);
      if (!d.name) {
        rejected++;
        continue;
      }
      count++;
      if (merged.has(d.name)) {
        // MERGE ORDER MATTERS: fill-gaps only, first file wins. Load the most
        // complete export first; a later partial cannot overwrite existing values.
        const base = merged.get(d.name) as Device;
        for (const k of Object.keys(d)) {
          if (k === '_src') continue;
          if ((base[k] == null || base[k] === '') && d[k] != null && d[k] !== '') base[k] = d[k];
        }
      } else {
        merged.set(d.name, d);
      }
    }
    // shape label requires a counts column AND a baseline column to call it a full combined run
    const hasCounts = map.hardResets != null || map.crashCount != null;
    const hasBaseline = map.dex != null && map.free != null;
    perFile.push({
      file: f.name,
      rows: count,
      rejected,
      hasCounts,
      shape:
        hasCounts && hasBaseline
          ? 'combined (baseline + counts)'
          : hasCounts
            ? 'counts export'
            : hasBaseline
              ? 'baseline export'
              : 'partial',
    });
  }
  return { devices: Array.from(merged.values()), perFile, headers: Array.from(allHeaders) };
}

/**
 * @param prior the previously committed run (legacy: `Store.currentRun()`).
 *              Pass `null` when there is none.
 */
export function ingestReport(ingested: Ingested, prior: Run | null): IngestReport {
  const { devices, perFile, headers } = ingested;
  const map = resolveHeaders(headers);
  const coverage: CoverageEntry[] = COLUMN_ROLES.map((c) => ({
    field: c.field,
    role: c.role,
    req: c.req,
    present: map[c.field] != null,
    column: map[c.field] || null,
  }));
  const missingReq = coverage.filter((c) => c.req && !c.present);

  const hriReset = map.hardResets != null;
  const hriCrash = map.crashCount != null;
  // PRESERVED BUG (B-08): a resets-only export reports 'unavailable' here even
  // though hriCounts() would score it in 'counts' mode.
  const hriMode =
    hriReset && hriCrash ? 'counts' : hriCrash ? 'counts-partial (no hard resets)' : 'unavailable';

  const nullRate = (f: string): number => {
    let miss = 0;
    devices.forEach((d) => {
      if (d[f] == null || d[f] === '') miss++;
    });
    return devices.length ? +((100 * miss) / devices.length).toFixed(1) : 0;
  };
  const nulls: NullRates = {
    dex: nullRate('dex'),
    crashes: nullRate('crashes'),
    free: nullRate('free'),
    ramGB: nullRate('ramGB'),
    age: nullRate('age'),
    hardResets: nullRate('hardResets'),
  };

  const anomalies: string[] = [];
  if (prior) {
    const swing = (100 * Math.abs(devices.length - prior.rows.length)) / (prior.rows.length || 1);
    if (swing > 15)
      anomalies.push(
        `Device count swing ${swing.toFixed(0)}% vs last run (${prior.rows.length} → ${devices.length})`,
      );
    const pnd = prior.report?.nulls?.dex ?? null;
    if (pnd != null && Math.abs(nulls.dex - pnd) > 10)
      anomalies.push(`Null DEX rate moved ${(nulls.dex - pnd).toFixed(1)}pp (${pnd}% → ${nulls.dex}%)`);
  }
  if (nulls.dex > 20)
    anomalies.push(
      `High null-DEX rate: ${nulls.dex}% — those devices score as unknown risk, not zero`,
    );
  if (hriMode === 'unavailable')
    anomalies.push(`No raw event counts — HRI unavailable. Add the Phase 4 / Query 2 counts export.`);

  return {
    fileCount: perFile.length,
    perFile,
    deviceCount: devices.length,
    rejected: perFile.reduce((a, f) => a + (f.rejected || 0), 0),
    coverage,
    missingReq,
    hriMode,
    hriReset,
    hriCrash,
    nulls,
    anomalies,
    gate:
      anomalies.length === 0 && missingReq.length === 0
        ? 'clean'
        : missingReq.length > 0
          ? 'block'
          : 'review',
  };
}

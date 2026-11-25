/* ============================================================
   investigate.ts — port of js/investigate.js. Deterministic. NO AI.
   Seven phases from the committed run + the scoped export package
   (Copilot turns this into the Nexthink prompt; Sentinel does not).

   PORT NOTE: `CFG` becomes an explicit parameter; `fmt` and `isExcluded`
   are imported instead of read off the global scope. Everything else,
   including the em dashes and the warning glyph in the package text,
   is byte-identical to the original output.
   ============================================================ */

import type { Cfg, Device, Run } from './types';
import { fmt } from './format';
import { isExcluded } from './scoring';

export interface Cluster {
  model: string;
  n: number;
  flagged: number;
  bugcheck: Record<string, number>;
  rate: number;
  topBug: [string, number] | null;
}

export interface Phase {
  n: number;
  title: string;
  q: string;
  kpis: [string, unknown][];
  table?: { head: string[]; rows: unknown[][] } | null;
  note: string;
  star?: boolean;
}

export function triageList(run: Run, cfg: Cfg): Device[] {
  const rows = run.rows.filter((r) => !r.excluded);
  const rank = (r: Device): number => {
    if (r.sev === 'FAILING') return 0;
    if (r.hidden) return 1;
    if (r.tier === 'CRITICAL') return 2;
    if (r.sev === 'DEGRADING') return 3;
    if (r.tier === 'HIGH') return 4;
    if (r.hri != null && r.hri >= cfg.hriBand.WATCH) return 5;
    return 99;
  };
  return rows
    .filter((r) => r.queue)
    .map((r) => ({ r, k: rank(r) }))
    .filter((x) => x.k < 99)
    .sort((a, b) => a.k - b.k || (b.r.crs as number) - (a.r.crs as number))
    .map((x) => x.r);
}

export function clusters(run: Run): Cluster[] {
  const rows = run.rows.filter((r) => !r.excluded);
  const byModel: Record<string, { model: string; n: number; flagged: number; bugcheck: Record<string, number> }> = {};
  rows.forEach((r) => {
    if (!r.model) return;
    byModel[r.model] = byModel[r.model] || { model: r.model, n: 0, flagged: 0, bugcheck: {} };
    byModel[r.model].n++;
    if (r.queue) byModel[r.model].flagged++;
    const bc = r.lastBugcheck;
    if (bc) {
      byModel[r.model].bugcheck[bc] = (byModel[r.model].bugcheck[bc] || 0) + 1;
    }
  });
  return Object.values(byModel)
    .filter((m) => m.n >= 3 && m.flagged / m.n >= 0.3 && m.flagged >= 2)
    .map((m) => ({
      ...m,
      rate: +((100 * m.flagged) / m.n).toFixed(0),
      topBug: (Object.entries(m.bugcheck).sort((a, b) => b[1] - a[1])[0] || null) as
        | [string, number]
        | null,
    }))
    .sort((a, b) => b.rate - a.rate || b.flagged - a.flagged);
}

export function buildPhases(run: Run, cfg: Cfg): Phase[] {
  const rows = run.rows.filter((r) => !r.excluded);
  const s = run.summary;
  const c = run.ceiling;
  const P: Phase[] = [];
  P.push({
    n: 1,
    title: 'Baseline',
    q: 'What shape is the fleet in?',
    kpis: [
      ['Devices in scope', s.inScope],
      ['Avg DEX', s.avgDEX ?? '—'],
      ['Avg composite CRS', s.avgCRS],
      ['Excluded owners', s.excluded],
    ],
    note: 'This is the DEX figure you report. Sanity-check before trusting anything downstream.',
  });
  const top = rows
    .slice()
    .sort((a, b) => (b.crs as number) - (a.crs as number))
    .slice(0, 25);
  P.push({
    n: 2,
    title: 'Risk Discovery',
    q: 'Which devices score worst?',
    kpis: [
      ['CRITICAL', s.tierCounts.CRITICAL],
      ['HIGH', s.tierCounts.HIGH],
      ['ELEVATED', s.tierCounts.ELEVATED],
    ],
    table: {
      head: ['Device', 'Owner', 'CRS', 'Tier', 'Driver'],
      rows: top.map((r) => [r.name, r.user || '—', fmt(r.crs), r.tier, r.driver]),
    },
    note: 'Top-25 composite work list.',
  });
  const cl = clusters(run);
  P.push({
    n: 3,
    title: 'Failure Patterns',
    q: 'What is recurring?',
    kpis: [
      ['Model clusters', cl.length],
      ['Devices w/ bugcheck', rows.filter((r) => r.lastBugcheck).length],
    ],
    table: cl.length
      ? {
          head: ['Model', 'Units', 'Flagged', 'Rate', 'Top bugcheck'],
          rows: cl.map((m) => [
            m.model,
            m.n,
            m.flagged,
            m.rate + '%',
            m.topBug ? `${m.topBug[0]} ×${m.topBug[1]}` : '—',
          ]),
        }
      : null,
    note: 'A model with a high flag rate is a platform problem. Several units sharing a bugcheck + model is a fleet-wide driver/firmware issue — verify the code against the vendor reference.',
  });
  const old3 = rows.filter((r) => r.age != null && r.age > 1095).length;
  const old2 = rows.filter((r) => r.age != null && r.age > 730 && r.age <= 1095).length;
  const lowram = rows.filter((r) => r.ramGB != null && r.ramGB <= 8).length;
  P.push({
    n: 4,
    title: 'Hardware Lifecycle',
    q: 'What is aging out?',
    kpis: [
      ['>3yr (proxy)', old3],
      ['2–3yr', old2],
      ['RAM ≤8GB', lowram],
    ],
    note: 'Refresh-candidate list. Age is collector first-seen, a floor not a measurement (capped at the collector install date).',
  });
  const dims = ['DEX', 'Crashes', 'Age', 'RAM', 'Storage', 'OS', 'Availability'];
  const contrib: Record<string, number> = {};
  dims.forEach((d) => (contrib[d] = 0));
  rows.forEach((r) => {
    for (const k in r.wtd) contrib[k] += r.wtd[k];
  });
  const ranked = Object.entries(contrib).sort((a, b) => b[1] - a[1]);
  const inert = Object.entries(c.inert)
    .filter(([, v]) => v)
    .map(([k]) => k);
  P.push({
    n: 5,
    title: 'Composite Risk',
    q: 'Where does risk concentrate?',
    kpis: [
      ['Max observed CRS', c.maxObserved],
      ['Max attainable', c.maxAttainable],
      ['Blocking ceiling', c.blockingCeiling ? 'YES' : 'no'],
    ],
    table: {
      head: ['Dimension', 'Total weighted contribution'],
      rows: ranked.map(([k, v]) => [k, Math.round(v)]),
    },
    note: inert.length
      ? `Inert dimensions (zero on >90%): ${inert.join(', ')} — weight is dead there.`
      : 'No inert dimensions. Driver ranking above tells you what moves the fleet.',
  });
  const failing = rows.filter((r) => r.sev === 'FAILING');
  const hiddenList = rows
    .filter((r) => r.hidden)
    .sort((a, b) => (b.hri as number) - (a.hri as number));
  const hiddenHighDex = hiddenList.filter((r) => r.dex != null && r.dex > 85).length;
  P.push({
    n: 6,
    title: 'HRI — hardware failing',
    q: 'What is physically failing?',
    star: true,
    kpis: [
      ['FAILING', s.sevCounts.FAILING],
      ['DEGRADING', s.sevCounts.DEGRADING],
      ['Hidden risk', s.hidden],
      ['Hidden w/ DEX>85', hiddenHighDex],
    ],
    table: hiddenList.length
      ? {
          head: ['Device', 'Owner', 'HRI', 'Sev', 'CRS tier', 'DEX', 'Bugcheck'],
          rows: hiddenList
            .slice(0, 25)
            .map((r) => [
              r.name,
              r.user || '—',
              fmt(r.hri),
              r.sev,
              r.tier,
              r.dex == null ? 'null' : r.dex,
              r.lastBugcheck || '—',
            ]),
        }
      : null,
    note:
      run.report.hriMode === 'counts'
        ? 'Hidden risk = HRI flags it, composite misses it. Nothing else in the stack finds these. HRI bands provisional until the ledger fills.'
        : `⚠️ HRI is ${run.report.hriMode} — add the counts export for a real watchlist. Everything reads STABLE without raw counts.`,
  });
  P.push({
    n: 7,
    title: 'Remediation',
    q: 'What do we do, and did last week hold?',
    kpis: [
      ['Queue size', triageList(run, cfg).length],
      ['Failing to action', failing.length],
      ['Clusters to escalate', cl.length],
    ],
    note: 'Ranked actions off the scoped queue. Prior-week outcome grading arrives with Validation.',
  });
  return P;
}

export function buildExportPackage(
  run: Run,
  cfg: Cfg,
): { text: string; count: number; clusters: number } {
  const list = triageList(run, cfg);
  const cl = clusters(run);
  const s = run.summary;
  const week = run.weekEnding || '—';
  const L: string[] = [];
  L.push('SENTINEL SCOPED INVESTIGATION PACKAGE');
  L.push(`Week ending: ${week}   |   HRI mode: ${run.report.hriMode}`);
  L.push('Generated deterministically by Sentinel. Copilot: use this to build a scoped');
  L.push('Nexthink investigation prompt (phases 2-7) for the devices below. Do not widen');
  L.push('scope beyond this list. Verify any bugcheck-to-component mapping before relying on it.');
  L.push('');
  L.push('FLEET CONTEXT');
  L.push(`  In scope: ${s.inScope}   Avg DEX: ${s.avgDEX ?? '—'}   Avg CRS: ${s.avgCRS}`);
  L.push(
    `  Composite: CRITICAL ${s.tierCounts.CRITICAL} · HIGH ${s.tierCounts.HIGH} · ELEVATED ${s.tierCounts.ELEVATED}`,
  );
  L.push(
    `  HRI: FAILING ${s.sevCounts.FAILING} · DEGRADING ${s.sevCounts.DEGRADING} · hidden risk ${s.hidden}`,
  );
  L.push('');
  if (cl.length) {
    L.push('MODEL / BUGCHECK CLUSTERS (investigate as a platform, not per device)');
    cl.forEach((m) =>
      L.push(
        `  ${m.model}: ${m.flagged}/${m.n} flagged (${m.rate}%)` +
          (m.topBug ? `, top bugcheck ${m.topBug[0]} ×${m.topBug[1]}` : ''),
      ),
    );
    L.push('');
  }
  L.push(`SCOPED DEVICES (${list.length}) — priority order`);
  L.push('  name | reason | CRS/tier | HRI/sev | driver | DEX | crashes | resets | bugcheck | model | OS');
  list.forEach((r) => {
    const reason =
      r.sev === 'FAILING'
        ? 'FAILING'
        : r.hidden
          ? 'HIDDEN-RISK'
          : r.tier === 'CRITICAL'
            ? 'CRITICAL'
            : r.sev === 'DEGRADING'
              ? 'DEGRADING'
              : r.tier === 'HIGH'
                ? 'HIGH'
                : 'WATCH';
    // PRESERVED DEAD BRANCH (B-05): `list` is already filtered to !excluded, so
    // the ⚠️verify path can never fire here.
    const own = isExcluded(r.user, cfg) ? `${r.user} ⚠️verify` : r.user || '—';
    void own; // the original computes it and never uses it either
    L.push(
      `  ${r.name} | ${reason} | ${fmt(r.crs)}/${r.tier} | ${r.hri == null ? '—' : fmt(r.hri)}/${r.sev} | ${r.driver} | ${r.dex == null ? 'null' : r.dex} | ${r.crashes ?? '—'} | ${r.hardResets ?? '—'} | ${r.lastBugcheck || '—'} | ${r.model || '—'} | ${r.os || '—'}`,
    );
  });
  L.push('');
  L.push('RETURN FORMAT (paste findings back into Sentinel → Handoff):');
  L.push(
    '  DEVICE: state=<triaged|actioned|resolved|deferred|false_positive>; component=<x>; cause=<x>; action=<x>; owner=<x>; note=<x>',
  );
  return { text: L.join('\n'), count: list.length, clusters: cl.length };
}

export interface ParsedFinding {
  device: string;
  changes: Record<string, string>;
}

export function parseFindings(text: string | null | undefined): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  String(text || '')
    .split(/\r?\n/)
    .forEach((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) return;
      const ci = line.indexOf(':');
      if (ci < 1) return;
      const device = line.slice(0, ci).trim().replace(/^DEVICE\s+/i, '');
      const changes: Record<string, string> = {};
      line
        .slice(ci + 1)
        .split(';')
        .forEach((pair) => {
          const eq = pair.indexOf('=');
          if (eq < 1) return;
          const k = pair.slice(0, eq).trim().toLowerCase();
          const v = pair.slice(eq + 1).trim();
          if (['state', 'component', 'cause', 'action', 'owner', 'note'].includes(k) && v)
            changes[k] = v;
        });
      if (device && Object.keys(changes).length) out.push({ device, changes });
    });
  return out;
}

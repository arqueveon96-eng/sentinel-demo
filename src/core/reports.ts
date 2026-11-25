/* ============================================================
   reports.ts — port of js/reports.js. Deterministic reports.
   Copy-paste ready: no hyperlinks, no reference markers, no
   sign-off blocks. Metrics supplied by the analyst are used
   exactly as given — never restated, never rounded, never invented.

   PORT NOTE: `CFG` and `Store` become explicit parameters.
   Output strings are byte-identical to the original.
   ============================================================ */

import type { Cfg, Run, StoreApi } from './types';
import { buildQueue, queueCounts } from './queue';
import { clusters } from './investigate';

export function driverRanking(run: Run): [string, number][] {
  const rows = run.rows.filter((r) => !r.excluded);
  const contrib: Record<string, number> = {};
  let total = 0;
  rows.forEach((r) => {
    for (const k in r.wtd) {
      contrib[k] = (contrib[k] || 0) + r.wtd[k];
      total += r.wtd[k];
    }
  });
  return Object.entries(contrib)
    .map(([k, v]) => [k, total ? +((100 * v) / total).toFixed(1) : 0] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

export interface Improvements {
  resolved: string[];
  fp: string[];
  actioned: string[];
}

/**
 * PRESERVED QUIRK (B-06): reads the WHOLE changelog, not just the current
 * week's entries, so a "this week" report accumulates every state change ever
 * recorded until the changelog is cleared.
 */
export function improvements(store: StoreApi): Improvements {
  const log = store.getChangelog();
  const resolved = new Set<string>();
  const fp = new Set<string>();
  const actioned = new Set<string>();
  log
    .filter((c) => c.field === 'state')
    .forEach((c) => {
      if (c.new === 'RESOLVED') resolved.add(c.device);
      else if (c.new === 'FALSE_POSITIVE') fp.add(c.device);
      else if (c.new === 'ACTIONED') actioned.add(c.device);
    });
  return { resolved: [...resolved], fp: [...fp], actioned: [...actioned] };
}

export function reportFourQuestions(
  run: Run,
  metrics: string | null | undefined,
  cfg: Cfg,
  store: StoreApi,
): string {
  const s = run.summary;
  const drivers = driverRanking(run).slice(0, 3);
  const imp = improvements(store);
  const q = buildQueue(run, cfg, store);
  const escalate = q.filter((d) => d.escalate);
  const L: string[] = [];
  L.push(`## Four Questions — Week ending ${run.weekEnding || '—'}`);
  L.push('');
  L.push('### 1. Current DEX for my area');
  L.push(
    s.avgDEX != null
      ? `Average DEX across ${s.inScope} in-scope devices is ${s.avgDEX}. Average composite CRS is ${s.avgCRS} (higher is worse).`
      : `DEX is unavailable for this run — ${s.inScope} devices in scope, average composite CRS ${s.avgCRS}.`,
  );
  L.push('');
  L.push('### 2. Top drivers');
  drivers.forEach(([k, v]) => L.push(`- ${k} — ${v}% of total fleet risk`));
  if (s.hidden > 0)
    L.push(`- Hidden hardware risk on ${s.hidden} device(s) the composite score misses`);
  L.push('');
  L.push('### 3. Actions taken this week');
  if (imp.actioned.length || imp.resolved.length || imp.fp.length) {
    if (imp.actioned.length) L.push(`- Remediation performed on ${imp.actioned.length} device(s)`);
    if (imp.resolved.length) L.push(`- ${imp.resolved.length} device(s) resolved`);
    if (imp.fp.length) L.push(`- ${imp.fp.length} flag(s) closed as false positive`);
  } else L.push('- No state changes recorded yet this week');
  if (metrics && metrics.trim()) L.push(`- ${metrics.trim()}`);
  L.push('');
  L.push('### 4. What improved because of those actions');
  if (imp.resolved.length)
    L.push(`- ${imp.resolved.length} device(s) moved to resolved and feed the validation ledger`);
  if (imp.fp.length)
    L.push(`- ${imp.fp.length} false positive(s) recorded — these tune the model`);
  if (!imp.resolved.length && !imp.fp.length)
    L.push('- Outcomes pending — record resolutions on the queue to populate this');
  if (escalate.length)
    L.push(`- Watch: ${escalate.length} device(s) flagged 3+ consecutive weeks and should escalate`);
  return L.join('\n');
}

export function reportWeeklyStatus(
  run: Run,
  metrics: string | null | undefined,
  cfg: Cfg,
  store: StoreApi,
): string {
  const s = run.summary;
  const q = buildQueue(run, cfg, store);
  const cc = queueCounts(q);
  const cl = clusters(run);
  const imp = improvements(store);
  const L: string[] = [];
  L.push(`## Weekly Status — Week ending ${run.weekEnding || '—'}`);
  L.push('');
  const done = cc.done || 0;
  const prog = cc.inprogress || 0;
  const todo = cc.notstarted || 0;
  L.push(
    `The proactive queue held ${cc.total} device(s) this week: ${done} resolved or closed, ${prog} in progress, ${todo} not yet started. Composite health shows ${s.tierCounts.CRITICAL} CRITICAL and ${s.tierCounts.HIGH} HIGH; the hardware track flags ${s.sevCounts.FAILING} FAILING and ${s.hidden} hidden-risk device(s) that experience metrics alone would miss.`,
  );
  L.push('');
  L.push('### Highlights');
  if (imp.resolved.length) L.push(`- Resolved ${imp.resolved.length} device(s)`);
  if (cl.length)
    L.push(`- ${cl.length} model/bugcheck cluster(s) identified — platform-level, not isolated`);
  if (s.hidden) L.push(`- ${s.hidden} hidden-risk device(s) surfaced by the HRI track`);
  if (cc.escalate)
    L.push(`- ${cc.escalate} device(s) at 3+ consecutive weeks flagged for escalation`);
  if (metrics && metrics.trim()) {
    L.push('');
    L.push('### Metrics');
    metrics
      .trim()
      .split(/\r?\n/)
      .forEach((m) => L.push(`- ${m.trim()}`));
  }
  L.push('');
  L.push('### Next week');
  L.push('- Work the queue top-down: FAILING, hidden risk, CRITICAL, then DEGRADING');
  if (cc.escalate) L.push(`- Escalate the ${cc.escalate} device(s) past three weeks`);
  if (cl.length) L.push('- Take the cluster finding(s) to a platform/firmware fix');
  return L.join('\n');
}

export function reportExecBrief(run: Run, cfg: Cfg, store: StoreApi): string {
  const s = run.summary;
  const q = buildQueue(run, cfg, store);
  const cc = queueCounts(q);
  const cl = clusters(run);
  const imp = improvements(store);
  const top3 = q.slice(0, 3).map((d) => d.name);
  const L: string[] = [];
  L.push(`## Executive Brief — Week ending ${run.weekEnding || '—'}`);
  L.push('');
  L.push(
    `Fleet DEX ${s.avgDEX != null ? s.avgDEX : 'unavailable'} across ${s.inScope} devices. ${s.sevCounts.FAILING} hardware-failing and ${s.hidden} hidden-risk device(s) are the week's real exposure; ${imp.resolved.length} were resolved. ${cc.escalate ? `${cc.escalate} device(s) have persisted three or more weeks and need escalation.` : 'No devices have persisted past the escalation threshold.'}`,
  );
  L.push('');
  L.push(
    `- Fleet health: ${s.tierCounts.CRITICAL} CRITICAL, ${s.tierCounts.HIGH} HIGH, avg CRS ${s.avgCRS}`,
  );
  L.push(`- Hidden hardware risk: ${s.hidden} device(s)`);
  L.push(`- Top three to work: ${top3.length ? top3.join(', ') : '—'}`);
  L.push(`- Platform risk: ${cl.length ? `${cl.length} model cluster(s)` : 'none identified'}`);
  L.push(`- Key risk: ${cc.escalate ? `${cc.escalate} device(s) past 3 weeks` : 'within normal weekly range'}`);
  L.push('');
  L.push(
    '_HRI bands are provisional pending outcome validation. Triage rank is relative and not shown here as absolute risk._',
  );
  return L.join('\n');
}

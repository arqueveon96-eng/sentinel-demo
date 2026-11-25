/* ============================================================
   handoff.ts — port of js/handoff.js. The bridge to the two spokes
   (Nexthink, Copilot). Package out, findings in, changelog roundup,
   handoff log.

   PORT NOTE: `downloadText()` and `copyText()` are NOT ported here.
   They are DOM/Blob/clipboard side effects, not logic, and `src/core/`
   is dependency-free by contract. Phase 2 gets them as a browser
   utility in `src/lib/`. Everything below is logic and is ported.
   `Store` becomes an explicit parameter.
   ============================================================ */

import type { StoreApi } from './types';
import type { ParsedFinding } from './investigate';

export interface ApplyFindingsResult {
  applied: number;
  unknown: string[];
  details: { device: string; fields: string[] }[];
}

export function applyFindings(
  parsed: ParsedFinding[],
  source: string | undefined,
  store: StoreApi,
): ApplyFindingsResult {
  const run = store.currentRun();
  if (!run) return { applied: 0, unknown: [], details: [] };
  const known = new Set(run.rows.map((r) => r.name));
  let applied = 0;
  const unknown: string[] = [];
  const details: { device: string; fields: string[] }[] = [];
  parsed.forEach((f) => {
    if (!known.has(f.device)) {
      unknown.push(f.device);
      return;
    }
    store.applyFinding(f.device, f.changes, source || 'copilot');
    applied++;
    details.push({ device: f.device, fields: Object.keys(f.changes) });
  });
  store.logHandoff(
    'in',
    'copilot',
    `${applied} device finding(s) applied${unknown.length ? `, ${unknown.length} unknown` : ''}`,
    applied,
  );
  return { applied, unknown, details };
}

export function formatRoundup(store: StoreApi): string {
  const run = store.currentRun();
  const log = store.getChangelog();
  const week = run?.weekEnding || '—';
  if (!log.length) return `## Weekly Change Roundup — ${week}\n\nNo changes recorded this week.`;
  const byDev: Record<string, typeof log> = {};
  log.forEach((c) => {
    (byDev[c.device] = byDev[c.device] || []).push(c);
  });
  const stateChanges = log.filter((c) => c.field === 'state');
  const resolved = stateChanges.filter((c) => c.new === 'RESOLVED').length;
  const inprog = stateChanges.filter((c) => c.new === 'ACTIONED' || c.new === 'TRIAGED').length;
  const L: string[] = [];
  L.push(`## Weekly Change Roundup — ${week}`);
  L.push('');
  L.push(
    `${log.length} change(s) across ${Object.keys(byDev).length} device(s). ${resolved} resolved, ${inprog} advanced.`,
  );
  L.push('');
  Object.entries(byDev).forEach(([dev, changes]) => {
    L.push(`**${dev}**`);
    changes.forEach((c) => {
      const oldv = c.old == null || c.old === '' ? '—' : c.old;
      L.push(`- ${c.field}: ${oldv} → ${c.new}  _(${c.source})_`);
    });
    L.push('');
  });
  return L.join('\n');
}

export interface HandoffRow {
  when: string;
  dir: string;
  platform: string;
  summary: string;
  week: string;
}

export function handoffRows(store: StoreApi): HandoffRow[] {
  return store.getHandoffLog().map((h) => ({
    when: new Date(h.ts).toLocaleString(),
    dir: h.direction === 'out' ? '→ out' : '← in',
    platform: h.platform,
    summary: h.summary,
    week: h.week || '—',
  }));
}

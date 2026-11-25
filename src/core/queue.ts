/* ============================================================
   queue.ts — port of js/workqueue.js. The actionable, remembering work list.

   PORT NOTE: renamed workqueue.js -> queue.ts per the brief's target layout.
   `CFG` and `Store` become explicit parameters. The reason objects still carry
   their legacy `cls` CSS class strings (`t-FAILING` etc.) — presentation
   leaking into logic is a preserved quirk, not something Phase 1 fixes.
   ============================================================ */

import type { Cfg, Device, QueueCounts, QueueReason, QueueRow, Run, StoreApi } from './types';

export function queueReason(r: Device, cfg: Cfg): QueueReason {
  if (r.sev === 'FAILING') return { rank: 0, label: 'FAILING', cls: 't-FAILING' };
  if (r.hidden) return { rank: 1, label: 'HIDDEN RISK', cls: 't-WATCH' };
  if (r.tier === 'CRITICAL') return { rank: 2, label: 'CRITICAL', cls: 't-CRITICAL' };
  if (r.sev === 'DEGRADING') return { rank: 3, label: 'DEGRADING', cls: 't-DEGRADING' };
  if (r.tier === 'HIGH') return { rank: 4, label: 'HIGH', cls: 't-HIGH' };
  if (r.hri != null && r.hri >= cfg.hriBand.WATCH)
    return { rank: 5, label: 'WATCH', cls: 't-WATCH' };
  return { rank: 99, label: '—', cls: 't-none' };
}

export function buildQueue(run: Run, cfg: Cfg, store: StoreApi): QueueRow[] {
  const rows = run.rows.filter((r) => r.queue && !r.excluded);
  return rows
    .map((r) => {
      const reason = queueReason(r, cfg);
      const qm = store.getQueue(r.name as string);
      const ws = store.getWork(r.name as string).state;
      return {
        name: r.name as string,
        user: r.user,
        model: r.model,
        crs: r.crs,
        tier: r.tier,
        hri: r.hri,
        sev: r.sev,
        driver: r.driver,
        dex: r.dex,
        bugcheck: r.lastBugcheck,
        reason,
        work: ws,
        state: qm.state,
        assignee: qm.assignee,
        ticketId: qm.ticketId,
        weeks: qm.consecutiveWeeks || 1,
        recurred: !!qm.recurred,
        deferReason: qm.deferReason,
        revisitDate: qm.revisitDate,
        escalate: (qm.consecutiveWeeks || 1) >= 3,
      } as QueueRow;
    })
    .sort((a, b) => a.reason.rank - b.reason.rank || (b.crs as number) - (a.crs as number));
}

export function queueCounts(q: QueueRow[]): QueueCounts {
  const c: QueueCounts = {
    total: q.length,
    done: 0,
    inprogress: 0,
    notstarted: 0,
    escalate: 0,
    unassigned: 0,
    byReason: {},
  };
  q.forEach((d) => {
    c[d.work] = ((c[d.work] as number) || 0) + 1;
    if (d.escalate) c.escalate++;
    if (!d.assignee) c.unassigned++;
    c.byReason[d.reason.label] = (c.byReason[d.reason.label] || 0) + 1;
  });
  return c;
}

export function advanceState(device: string, store: StoreApi): string {
  const order = ['NEW', 'TRIAGED', 'ACTIONED', 'RESOLVED'];
  const cur = store.getQueue(device).state;
  const idx = order.indexOf(cur);
  const next = idx < 0 ? 'TRIAGED' : order[Math.min(idx + 1, order.length - 1)];
  store.setDeviceState(device, next, 'queue');
  return next;
}

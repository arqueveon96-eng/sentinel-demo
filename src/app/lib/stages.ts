/* ============================================================
   stages.ts — the stage rail's state, derived from the store.

   The rail is the only primary navigation, so what it says has to be
   true without the operator checking anything else:

     Pull        done once a run is committed
     Score       done once a run is committed (the same act freezes the baseline)
     Investigate findings recorded / scoped
     Work        devices moved off NEW / scoped
     Close       outcomes recorded / devices worked

   NOW is the first stage with work remaining. The rail *suggests* the
   sequence; every card stays clickable.

   Pure: takes plain data, returns plain data. Tested in
   src/app/__tests__/stages.test.ts.
   ============================================================ */

import type { Outcome, QueueRow, Run, SentinelState } from '@/core/types';

export type StageId = 'pull' | 'score' | 'investigate' | 'work' | 'close';
export type StageStatus = 'done' | 'now' | 'upcoming';

export interface Stage {
  id: StageId;
  /** 1-5, shown in the rail's numbered dot */
  n: number;
  label: string;
  /** the day band, as the mockups letter it */
  days: string;
  status: StageStatus;
  /** the one line of live status under the label */
  line: string;
  /** progress, when the stage counts something — used by the sliding digits */
  done: number;
  total: number;
}

export interface StageInput {
  run: Run | null;
  queue: QueueRow[];
  /** run.overlay — a device with any overlay field has a recorded finding */
  overlay: Record<string, Record<string, unknown>>;
  outcomes: Outcome[];
  /** files chosen but not yet committed */
  staged: number;
}

const SHAPE: { id: StageId; n: number; label: string; days: string }[] = [
  { id: 'pull', n: 1, label: 'Pull', days: 'MON' },
  { id: 'score', n: 2, label: 'Score', days: 'MON' },
  { id: 'investigate', n: 3, label: 'Investigate', days: 'MON–TUE' },
  { id: 'work', n: 4, label: 'Work', days: 'WED–THU' },
  { id: 'close', n: 5, label: 'Close', days: 'FRI' },
];

export const STAGE_IDS: StageId[] = SHAPE.map((s) => s.id);

/** Devices whose finding has been recorded this run. */
export function findingsRecorded(
  overlay: Record<string, Record<string, unknown>>,
  queue: QueueRow[],
): number {
  const names = new Set(queue.map((q) => q.name));
  return Object.keys(overlay || {}).filter(
    (name) => names.has(name) && Object.keys(overlay[name] || {}).length > 0,
  ).length;
}

/** Devices the operator has moved off NEW. */
export function worked(queue: QueueRow[]): number {
  return queue.filter((q) => q.state !== 'NEW').length;
}

/** Queued devices with a recorded, graded outcome in this run's week. */
export function outcomesForRun(outcomes: Outcome[], run: Run | null, queue: QueueRow[]): number {
  if (!run) return 0;
  const names = new Set(queue.map((q) => q.name));
  const seen = new Set<string>();
  outcomes.forEach((o) => {
    if (o.week === run.weekEnding && names.has(o.device) && o.outcome !== 'pending')
      seen.add(o.device);
  });
  return seen.size;
}

function pullLine(run: Run | null, staged: number): string {
  if (!run)
    return staged
      ? `${staged} file${staged === 1 ? '' : 's'} staged · not committed`
      : 'Drop the weekly Nexthink export to start';
  const r = run.report;
  const mode =
    r.hriMode === 'counts'
      ? 'counts present'
      : r.hriMode === 'unavailable'
        ? 'no raw counts'
        : r.hriMode;
  const files = r.fileCount === 1 ? '1 file' : `${r.fileCount} files`;
  return `${files} · ${r.deviceCount} rows · ${mode}`;
}

function workLine(queue: QueueRow[]): string {
  if (!queue.length) return 'Set state · draft proactive tickets';
  const by = (s: string) => queue.filter((q) => q.state === s).length;
  const actioned = by('ACTIONED') + by('RESOLVED');
  const deferred = by('DEFERRED');
  const fp = by('FALSE_POSITIVE');
  if (!actioned && !deferred && !fp) return 'Set state · draft proactive tickets';
  const bits = [`${actioned} actioned`];
  if (deferred) bits.push(`${deferred} deferred`);
  if (fp) bits.push(`${fp} false positive${fp === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

/**
 * The five stage cards. `status` is assigned in one pass: everything before
 * the first stage with work remaining is done, that stage is NOW, the rest
 * are upcoming.
 */
export function deriveStages(input: StageInput): Stage[] {
  const { run, queue, overlay, outcomes, staged } = input;
  const scoped = queue.length;
  const found = findingsRecorded(overlay, queue);
  const workedN = worked(queue);
  const closed = outcomesForRun(outcomes, run, queue);

  const complete: Record<StageId, boolean> = {
    pull: !!run,
    score: !!run,
    investigate: !!run && scoped > 0 && found >= scoped,
    work: !!run && scoped > 0 && workedN >= scoped,
    close: !!run && workedN > 0 && closed >= workedN,
  };

  const lines: Record<StageId, string> = {
    pull: pullLine(run, staged),
    score: run
      ? `${run.summary.inScope} scored · ${scoped} queued · baseline frozen`
      : 'Composite CRS, triage rank and HRI — never merged',
    investigate: run
      ? `${found} of ${scoped} findings recorded`
      : 'Read Phase 6 first · scoped deep dives',
    work: workLine(queue),
    close: run
      ? `${closed} of ${workedN} outcomes recorded`
      : 'Record outcomes · Four Questions · Exec Brief',
  };

  const totals: Record<StageId, { done: number; total: number }> = {
    pull: { done: run ? run.report.deviceCount : staged, total: run ? run.report.deviceCount : 0 },
    score: { done: scoped, total: scoped },
    investigate: { done: found, total: scoped },
    work: { done: workedN, total: scoped },
    close: { done: closed, total: workedN },
  };

  const nowIdx = SHAPE.findIndex((s) => !complete[s.id]);
  return SHAPE.map((s, i) => ({
    ...s,
    status: (nowIdx === -1
      ? 'done'
      : i < nowIdx
        ? 'done'
        : i === nowIdx
          ? 'now'
          : 'upcoming') as StageStatus,
    line: lines[s.id],
    ...totals[s.id],
  }));
}

/** The stage the operator should land on. */
export function nowStage(stages: Stage[]): StageId {
  return (stages.find((s) => s.status === 'now') ?? stages[stages.length - 1]).id;
}

/** Convenience for callers that hold the raw blob. */
export function stageInputFromState(
  state: SentinelState,
  queue: QueueRow[],
  staged = 0,
): StageInput {
  return {
    run: state.committedRun,
    queue,
    overlay: state.committedRun?.overlay ?? {},
    outcomes: state.outcomes ?? [],
    staged,
  };
}

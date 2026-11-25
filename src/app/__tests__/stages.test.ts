/* ============================================================
   stages.test.ts — the rail is the only navigation, so what it says
   has to be true. Every branch of the derivation is pinned here.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  deriveStages,
  findingsRecorded,
  nowStage,
  outcomesForRun,
  worked,
  type StageInput,
} from '@/app/lib/stages';
import type { Outcome, QueueRow, Run } from '@/core/types';

function qrow(name: string, state: QueueRow['state'] = 'NEW'): QueueRow {
  return {
    name,
    reason: { rank: 0, label: 'FAILING', cls: 't-FAILING' },
    work: 'notstarted',
    state,
    assignee: '',
    ticketId: '',
    weeks: 1,
    recurred: false,
    deferReason: '',
    revisitDate: '',
    escalate: false,
  } as QueueRow;
}

function run(over: Partial<Run> = {}): Run {
  return {
    weekEnding: '2026-09-03',
    committedAt: '2026-09-03T10:00:00.000Z',
    rows: [],
    report: { fileCount: 1, deviceCount: 260, hriMode: 'counts' } as Run['report'],
    ceiling: {} as Run['ceiling'],
    summary: { inScope: 254 } as Run['summary'],
    ...over,
  };
}

function outcome(device: string, over: Partial<Outcome> = {}): Outcome {
  return {
    device,
    week: '2026-09-03',
    predictedSev: 'FAILING',
    predictedTier: 'HIGH',
    hri: 44,
    crs: 42,
    outcome: 'confirmed_fail',
    component: '',
    leadDays: 2,
    note: '',
    ts: '2026-09-05T10:00:00.000Z',
    ...over,
  };
}

const empty: StageInput = { run: null, queue: [], overlay: {}, outcomes: [], staged: 0 };

describe('deriveStages — before anything is committed', () => {
  it('puts NOW on Pull and leaves the rest upcoming', () => {
    const s = deriveStages(empty);
    expect(s.map((x) => x.status)).toEqual(['now', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(nowStage(s)).toBe('pull');
    expect(s[0].line).toBe('Drop the weekly Nexthink export to start');
  });

  it('counts staged files without claiming they are committed', () => {
    const s = deriveStages({ ...empty, staged: 2 });
    expect(s[0].line).toBe('2 files staged · not committed');
    expect(s[0].status).toBe('now');
  });
});

describe('deriveStages — a committed run', () => {
  const queue = [qrow('A'), qrow('B'), qrow('C')];
  const base: StageInput = { run: run(), queue, overlay: {}, outcomes: [], staged: 0 };

  it('marks Pull and Score done and moves NOW to Investigate', () => {
    const s = deriveStages(base);
    expect(s.map((x) => x.status)).toEqual(['done', 'done', 'now', 'upcoming', 'upcoming']);
    expect(nowStage(s)).toBe('investigate');
  });

  it('reports the ingest shape on Pull and the scope on Score', () => {
    const s = deriveStages(base);
    expect(s[0].line).toBe('1 file · 260 rows · counts present');
    expect(s[1].line).toBe('254 scored · 3 queued · baseline frozen');
  });

  it('says so when the export arrived without raw counts', () => {
    const s = deriveStages({
      ...base,
      run: run({ report: { fileCount: 1, deviceCount: 10, hriMode: 'unavailable' } as Run['report'] }),
    });
    expect(s[0].line).toContain('no raw counts');
  });

  it('counts findings only for devices that are actually in the queue', () => {
    const overlay = { A: { state: 'actioned' }, ZZ: { state: 'actioned' }, B: {} };
    expect(findingsRecorded(overlay, queue)).toBe(1);
    const s = deriveStages({ ...base, overlay });
    expect(s[2].line).toBe('1 of 3 findings recorded');
    expect(s[2].status).toBe('now');
  });

  it('completes Investigate only when every scoped device has a finding', () => {
    const overlay = { A: { state: 'a' }, B: { state: 'b' }, C: { state: 'c' } };
    const s = deriveStages({ ...base, overlay });
    expect(s[2].status).toBe('done');
    expect(nowStage(s)).toBe('work');
  });
});

describe('deriveStages — Work and Close', () => {
  const overlay = { A: { state: 'a' }, B: { state: 'b' }, C: { state: 'c' } };

  it('summarises Work by state, and says what to do before anything is set', () => {
    const s = deriveStages({ run: run(), queue: [qrow('A'), qrow('B')], overlay: {}, outcomes: [], staged: 0 });
    expect(s[3].line).toBe('Set state · draft proactive tickets');
  });

  it('counts actioned, deferred and false positives once they exist', () => {
    const queue = [qrow('A', 'ACTIONED'), qrow('B', 'DEFERRED'), qrow('C', 'FALSE_POSITIVE')];
    const s = deriveStages({ run: run(), queue, overlay, outcomes: [], staged: 0 });
    expect(s[3].line).toBe('1 actioned · 1 deferred · 1 false positive');
    expect(worked(queue)).toBe(3);
    expect(s[3].status).toBe('done');
    expect(nowStage(s)).toBe('close');
  });

  it('measures Close against what was worked, not against the whole queue', () => {
    const queue = [qrow('A', 'ACTIONED'), qrow('B', 'ACTIONED'), qrow('C')];
    const s = deriveStages({ run: run(), queue, overlay, outcomes: [outcome('A')], staged: 0 });
    expect(s[4].line).toBe('1 of 2 outcomes recorded');
    // C is still NEW, so Work is where the work is — Close stays ahead of it
    expect(nowStage(s)).toBe('work');
    expect(s[4].status).toBe('upcoming');
  });

  it('ignores outcomes from another week, another device, or still pending', () => {
    const queue = [qrow('A', 'ACTIONED')];
    const outcomes = [
      outcome('A', { week: '2026-08-27' }),
      outcome('ZZ'),
      outcome('A', { outcome: 'pending' }),
    ];
    expect(outcomesForRun(outcomes, run(), queue)).toBe(0);
  });

  it('counts a device once even if its outcome was recorded twice', () => {
    const queue = [qrow('A', 'ACTIONED')];
    expect(outcomesForRun([outcome('A'), outcome('A', { outcome: 'no_fail' })], run(), queue)).toBe(1);
  });

  it('falls back to the last stage when every stage is complete', () => {
    const queue = [qrow('A', 'RESOLVED')];
    const s = deriveStages({
      run: run(),
      queue,
      overlay: { A: { state: 'a' } },
      outcomes: [outcome('A')],
      staged: 0,
    });
    expect(s.every((x) => x.status === 'done')).toBe(true);
    expect(nowStage(s)).toBe('close');
  });
});

describe('deriveStages — an empty queue is not a finished week', () => {
  it('does not report Investigate done when nothing was scoped', () => {
    const s = deriveStages({ run: run(), queue: [], overlay: {}, outcomes: [], staged: 0 });
    expect(s[2].status).toBe('now');
    expect(s[2].line).toBe('0 of 0 findings recorded');
  });
});

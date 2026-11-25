/* ============================================================
   trends.test.ts — the Phase 3 data shaping.

   The charts are only as honest as this module. Every test here is
   about one of two promises: the series is in the right order, and a
   figure the store never recorded comes back as `null` rather than as
   a number the view could draw.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  allFull,
  deltaRows,
  deltaTone,
  fmtDelta,
  hasTrend,
  makeRunMeta,
  mergeRunMeta,
  readRunMeta,
  trendPoints,
  type RunMeta,
} from '@/core/trends';
import { makeCfg } from '@/core/scoring';
import { buildRun } from '@/core/pipeline';
import type { RunHistoryEntry, SentinelState } from '@/core/types';
import { blankState } from '@/core/store-core';
import { sampleFile } from '@/test/fixtures';

function hist(week: string, over: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    weekEnding: week,
    committedAt: `${week}T09:00:00.000Z`,
    deviceCount: 200,
    avgCRS: 20,
    avgDEX: 70,
    critical: 2,
    high: 20,
    hriWatch: 30,
    hidden: 10,
    ...over,
  };
}

function meta(week: string, over: Partial<RunMeta> = {}): RunMeta {
  return {
    weekEnding: week,
    committedAt: `${week}T09:00:00.000Z`,
    inScope: 200,
    excluded: 60,
    avgDEX: 70,
    avgCRS: 20,
    tierCounts: { CRITICAL: 2, HIGH: 20, ELEVATED: 40, MONITOR: 100, HEALTHY: 38 },
    sevCounts: { FAILING: 1, DEGRADING: 12, WATCH: 17, STABLE: 170 },
    hidden: 10,
    hriWatch: 30,
    hriAvail: 200,
    ...over,
  };
}

describe('makeRunMeta', () => {
  it('copies the committed run summary — every figure is the core’s own', () => {
    const cfg = makeCfg();
    const { run } = buildRun('2026-09-04', [sampleFile()], cfg, null);
    const m = makeRunMeta(run);
    expect(m.weekEnding).toBe('2026-09-04');
    expect(m.inScope).toBe(run.summary.inScope);
    expect(m.avgCRS).toBe(run.summary.avgCRS);
    expect(m.tierCounts).toEqual(run.summary.tierCounts);
    expect(m.sevCounts).toEqual(run.summary.sevCounts);
    expect(m.hidden).toBe(run.summary.hidden);
    // and it is a copy, so a later mutation of the run cannot rewrite history
    run.summary.tierCounts.CRITICAL = 999;
    expect(m.tierCounts.CRITICAL).not.toBe(999);
  });
});

describe('readRunMeta / mergeRunMeta', () => {
  it('reads nothing out of a blob that has never held the key', () => {
    expect(readRunMeta(blankState())).toEqual([]);
    expect(readRunMeta(null)).toEqual([]);
  });

  it('ignores a malformed entry rather than charting it', () => {
    const s = { ...blankState(), runMeta: [meta('2026-09-04'), null, 7, { nope: true }] };
    expect(readRunMeta(s as unknown as SentinelState)).toHaveLength(1);
  });

  it('re-committing a week replaces that week’s record, it does not duplicate it', () => {
    const first = meta('2026-09-04', { avgCRS: 20 });
    const again = meta('2026-09-04', { avgCRS: 21, committedAt: '2026-09-04T18:00:00.000Z' });
    const list = mergeRunMeta(mergeRunMeta([], first), again);
    expect(list).toHaveLength(1);
    expect(list[0].avgCRS).toBe(21);
  });

  it('keeps 52 weeks, newest first, like runHistory', () => {
    let list: RunMeta[] = [];
    for (let i = 0; i < 60; i++) list = mergeRunMeta(list, meta(`2025-01-${String(i + 1).padStart(2, '0')}`));
    expect(list).toHaveLength(52);
  });
});

describe('trendPoints', () => {
  it('returns the committed weeks oldest first, whatever order the store held them', () => {
    const points = trendPoints([hist('2026-09-18'), hist('2026-09-04'), hist('2026-09-11')], []);
    expect(points.map((p) => p.week)).toEqual(['2026-09-04', '2026-09-11', '2026-09-18']);
  });

  it('a week committed twice appears once — the later commit wins', () => {
    const points = trendPoints(
      [
        hist('2026-09-04', { committedAt: '2026-09-04T18:00:00.000Z', avgCRS: 22 }),
        hist('2026-09-04', { committedAt: '2026-09-04T09:00:00.000Z', avgCRS: 20 }),
      ],
      [],
    );
    expect(points).toHaveLength(1);
    expect(points[0].avgCRS).toBe(22);
  });

  it('without a runMeta record, the tiers it cannot know are null and `full` is false', () => {
    const [p] = trendPoints([hist('2026-09-04')], []);
    expect(p.full).toBe(false);
    expect(p.elevated).toBeNull();
    expect(p.monitor).toBeNull();
    expect(p.healthy).toBeNull();
    expect(p.failing).toBeNull();
    expect(p.stable).toBeNull();
    // but CRITICAL, HIGH and the exact remainder are real
    expect(p.critical).toBe(2);
    expect(p.high).toBe(20);
    expect(p.rest).toBe(178);
    expect(p.critical + p.high + p.rest).toBe(p.devices);
  });

  it('with a runMeta record, the whole CRITICAL→HEALTHY composition is real', () => {
    const [p] = trendPoints([hist('2026-09-04')], [meta('2026-09-04')]);
    expect(p.full).toBe(true);
    expect([p.critical, p.high, p.elevated, p.monitor, p.healthy]).toEqual([2, 20, 40, 100, 38]);
    expect(p.critical + p.high + (p.elevated ?? 0) + (p.monitor ?? 0) + (p.healthy ?? 0)).toBe(
      p.devices,
    );
    expect([p.failing, p.degrading, p.watch, p.stable]).toEqual([1, 12, 17, 170]);
  });

  it('never lets `rest` go negative if a record disagrees with its history entry', () => {
    const [p] = trendPoints([hist('2026-09-04', { deviceCount: 5, critical: 4, high: 4 })], []);
    expect(p.rest).toBe(0);
  });

  it('carries a null avg DEX through as null — an unavailable DEX is not a zero', () => {
    const [p] = trendPoints([hist('2026-09-04', { avgDEX: null })], []);
    expect(p.avgDEX).toBeNull();
  });

  it('reads nothing out of an empty or absent history', () => {
    expect(trendPoints([], [])).toEqual([]);
    expect(trendPoints(null, null)).toEqual([]);
  });
});

describe('hasTrend / allFull', () => {
  it('one committed week is not a trend', () => {
    expect(hasTrend(trendPoints([hist('2026-09-04')], []))).toBe(false);
    expect(hasTrend(trendPoints([hist('2026-09-04'), hist('2026-09-11')], []))).toBe(true);
  });

  it('a five-tier stack is only offered when every week really recorded one', () => {
    const h = [hist('2026-09-04'), hist('2026-09-11')];
    expect(allFull(trendPoints(h, [meta('2026-09-04')]))).toBe(false);
    expect(allFull(trendPoints(h, [meta('2026-09-04'), meta('2026-09-11')]))).toBe(true);
    expect(allFull([])).toBe(false);
  });
});

describe('deltaRows', () => {
  const prev = trendPoints([hist('2026-09-04')], [meta('2026-09-04')])[0];
  const cur = trendPoints(
    [hist('2026-09-11')],
    [
      meta('2026-09-11', {
        tierCounts: { CRITICAL: 5, HIGH: 18, ELEVATED: 40, MONITOR: 100, HEALTHY: 37 },
        sevCounts: { FAILING: 3, DEGRADING: 12, WATCH: 17, STABLE: 168 },
        hidden: 7,
        avgDEX: 72,
        avgCRS: 21.5,
      }),
    ],
  )[0];

  it('reports the tier and band movement between two committed weeks', () => {
    const d = deltaRows(prev, cur);
    expect(d.tiers.find((r) => r.label === 'CRITICAL')?.delta).toBe(3);
    expect(d.tiers.find((r) => r.label === 'HIGH')?.delta).toBe(-2);
    expect(d.bands.find((r) => r.label === 'FAILING')?.delta).toBe(2);
    expect(d.fleet.find((r) => r.label === 'Hidden risk')?.delta).toBe(-3);
    expect(d.fleet.find((r) => r.label === 'Avg composite CRS')?.delta).toBe(1.5);
  });

  it('a figure the prior week never recorded comes back null, not zero', () => {
    const thin = trendPoints([hist('2026-09-04')], [])[0];
    const d = deltaRows(thin, cur);
    expect(d.tiers.find((r) => r.label === 'ELEVATED')?.delta).toBeNull();
    expect(d.bands.find((r) => r.label === 'FAILING')?.delta).toBeNull();
    // the ones both weeks do hold are still real
    expect(d.tiers.find((r) => r.label === 'CRITICAL')?.delta).toBe(3);
  });

  it('knows which direction is the good one', () => {
    const d = deltaRows(prev, cur);
    expect(deltaTone(d.tiers.find((r) => r.label === 'CRITICAL')!)).toBe('worse');
    expect(deltaTone(d.tiers.find((r) => r.label === 'HIGH')!)).toBe('better');
    expect(deltaTone(d.fleet.find((r) => r.label === 'Avg DEX')!)).toBe('better');
    expect(deltaTone(d.tiers.find((r) => r.label === 'ELEVATED')!)).toBe('same');
    expect(deltaTone({ label: 'x', prev: null, cur: 1, delta: null, riseIsWorse: true })).toBe(
      'unknown',
    );
  });
});

describe('fmtDelta', () => {
  it('says nothing it does not know, and uses a real minus sign', () => {
    expect(fmtDelta(3)).toBe('+3');
    expect(fmtDelta(-2)).toBe('−2');
    expect(fmtDelta(0)).toBe('no change');
    expect(fmtDelta(null)).toBe('not recorded');
  });
});

/* ============================================================
   hristar.test.ts — the experimental parallel track.

   hristar.js is NOT one of the ten, and its logic half is ported opt-in
   (see src/core/hristar.ts for the call). Two things need proving:

     1. the module's own stated design guarantee — HRI* >= HRI on every
        device, so a DIVERGE can only ever mean "HRI* caught more";
     2. that leaving it opt-in changes nothing — a run scored with
        computeStar applied is identical to one without it on every
        field that drives dispatch.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { makeCfg, scoreDevice } from '@/core/scoring';
import { computeStar, ensureStarBands, starCrash, starReset, starSoft } from '@/core/hristar';
import { createStore } from '@/core/store-core';
import { buildRun } from '@/core/pipeline';
import { memoryPersistence, sampleFile } from '@/test/fixtures';

const cfg = makeCfg();
const store = createStore(memoryPersistence());
ensureStarBands(cfg, store);

describe('HRI* curves', () => {
  it('reset and crash curves are identical to production', () => {
    for (const n of [null, 0, 1, 2, 3, 4, 5, 9, 10, 50]) {
      expect(starReset(n)).toBe(
        n == null ? 0 : n >= 10 ? 40 : n >= 5 ? 33 : n >= 3 ? 26 : n >= 2 ? 21 : n >= 1 ? 16 : 0,
      );
      expect(starCrash(n)).toBe(
        n == null ? 0 : n >= 5 ? 40 : n >= 3 ? 33 : n >= 2 ? 28 : n >= 1 ? 18 : 0,
      );
    }
  });

  it('the uptime curve is fuller than production and ungated', () => {
    expect(starSoft(null)).toBe(0);
    expect(starSoft(7)).toBe(0);
    expect(starSoft(8)).toBe(3);
    expect(starSoft(15)).toBe(6);
    expect(starSoft(31)).toBe(10);
  });

  it('the burst override pegs resets at 40', () => {
    const d = computeStar({ hardResets: 0, crashCount: 1, burstFlag: true }, cfg);
    expect(d.hriStarParts).toEqual({ reset: 40, crash: 18, soft: 0, burst: true });
    expect(d.burst).toBe(true);
  });
});

describe('the design guarantee: HRI* >= HRI on every device', () => {
  it('holds across the whole 300-device sample', () => {
    const { run } = buildRun('2026-08-07', [sampleFile()], cfg, null);
    let compared = 0;
    for (const d of run.rows) {
      computeStar(d, cfg);
      if (d.hri == null) {
        expect(d.hriStar).toBeNull();
        continue;
      }
      compared++;
      expect(d.hriStar as number).toBeGreaterThanOrEqual(d.hri);
      expect(d.hriAgree === 'MATCH' || d.hriAgree === 'DIVERGE').toBe(true);
    }
    expect(compared).toBe(300); // the sample carries counts for every device
  });

  it('a DIVERGE only ever escalates', () => {
    const order = { STABLE: 0, WATCH: 1, DEGRADING: 2, FAILING: 3 } as const;
    const { run } = buildRun('2026-08-07', [sampleFile()], cfg, null);
    for (const d of run.rows) {
      computeStar(d, cfg);
      if (d.hriAgree !== 'DIVERGE') continue;
      expect(order[d.sevStar as keyof typeof order]).toBeGreaterThan(
        order[d.sev as keyof typeof order],
      );
    }
  });
});

describe('leaving HRI* opt-in changes nothing that drives dispatch', () => {
  it('applying computeStar does not move crs, tier, hri, sev, hidden or queue', () => {
    const base = scoreDevice({ name: 'D', dex: 90, hardResets: 3, crashCount: 1, boot: 40 }, cfg);
    const snapshot = JSON.stringify({
      crs: base.crs,
      tier: base.tier,
      hri: base.hri,
      sev: base.sev,
      hidden: base.hidden,
      queue: base.queue,
      driver: base.driver,
    });
    computeStar(base, cfg);
    expect(
      JSON.stringify({
        crs: base.crs,
        tier: base.tier,
        hri: base.hri,
        sev: base.sev,
        hidden: base.hidden,
        queue: base.queue,
        driver: base.driver,
      }),
    ).toBe(snapshot);
    // and it did add the parallel fields: 26 reset + 18 crash + 10 soft
    expect(base.hriStar).toBe(54);
    // production HRI is 49 on the same device — the binary >14 soft rule gives 5,
    // the fuller HRI* curve gives 10. HRI* is higher, never lower.
    expect(base.hri).toBe(49);
  });
});

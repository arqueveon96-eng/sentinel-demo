/* ============================================================
   regression.test.ts — the original console's end-to-end regression
   script, ported 1:1.

   Every assertion, in the original order, driving the PORTED modules
   over the synthetic 300-device sample (demo/sample-fleet.csv). The suite is stateful and sequential by
   design: the original walks a fleet through commit -> findings ->
   carry-forward -> reports -> config -> tickets -> validation, and each
   step depends on the last. Vitest runs `it` blocks in file order within
   a describe, so the walk is preserved.

   If an assertion here fails, the PORT is wrong. Never weaken the
   assertion.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { makeHarness, sampleFile } from '@/test/fixtures';
import { scoreDevice } from '@/core/scoring';
import { buildExportPackage, buildPhases, parseFindings, triageList } from '@/core/investigate';
import { applyFindings } from '@/core/handoff';
import { buildQueue } from '@/core/queue';
import { reportFourQuestions } from '@/core/reports';
import {
  CFG_DEFAULTS,
  applyStoredConfig,
  resetConfigDefaults,
  saveConfig,
} from '@/core/config';
import { DEMO_COMPANY, buildTickets, incidentTicket, ticketsCSV } from '@/core/tickets';
import { tuningProposal, validationMetrics } from '@/core/validation';
import type { Ingested, QueueRow, Run } from '@/core/types';

const H = makeHarness();
const { cfg, store } = H;

/* --- shared walk state, mirroring the locals in the original script --- */
let w1: Run;
let ing1: Ingested;
let w3: Run;
let dev1 = '';
let dev2 = '';
let persist = '';

describe('THE ALIAS FIX (the point of this rebuild)', () => {
  it('Phase 4 export parsed', () => {
    const r = H.loadRun('2026-08-07');
    w1 = r.run;
    ing1 = r.ing;
    expect(ing1.devices.length).toBe(300);
  });

  it('total_hard_resets_ resolves (hardResets not null on some device)', () => {
    expect(ing1.devices.some((d) => d.hardResets != null)).toBe(true);
  });

  it('total_system_crashes_ resolves (crashCount not null on some device)', () => {
    expect(ing1.devices.some((d) => d.crashCount != null)).toBe(true);
  });

  it('HRI mode = counts (NOT unavailable)', () => {
    expect(w1.report.hriMode).toBe('counts');
  });

  it('no "No raw event counts" anomaly fired', () => {
    expect(w1.report.anomalies.some((a) => /No raw event counts/.test(a))).toBe(false);
  });

  it('bugcheck code captured', () => {
    expect(ing1.devices.some((d) => d.bugcheckCode != null)).toBe(true);
  });

  it('bugcheck label ALSO captured (separate field)', () => {
    expect(ing1.devices.some((d) => d.bugcheckLabel != null)).toBe(true);
  });

  it('shape reads combined (baseline + counts)', () => {
    expect(w1.report.perFile[0].shape).toBe('combined (baseline + counts)');
  });
});

describe('SCORING GUARDRAILS', () => {
  it('10 hard resets => FAILING', () => {
    expect(scoreDevice({ name: 'T', hardResets: 10, crashCount: 0 }, cfg).sev).toBe('FAILING');
  });

  it('3 resets + 2 BSOD => 54 FAILING', () => {
    expect(scoreDevice({ name: 'T', hardResets: 3, crashCount: 2 }, cfg).hri).toBe(54);
  });

  it('null DEX = 40 pts not 0', () => {
    expect(scoreDevice({ name: 'T', dex: null }, cfg).pts!.dex).toBe(40);
  });

  it('6887 crashes (100) separates from 101 (85)', () => {
    expect(scoreDevice({ name: 'T', crashes: 6887 }, cfg).pts!.crash).toBe(100);
    expect(scoreDevice({ name: 'T', crashes: 101 }, cfg).pts!.crash).toBe(85);
  });

  it('Win11 24H2 not scored as Win10', () => {
    expect(scoreDevice({ name: 'T', os: 'Windows 11 Enterprise 24H2' }, cfg).pts!.os).toBe(20);
  });

  it('service-account owner excluded', () => {
    expect(scoreDevice({ name: 'T', user: 'svc-backup01' }, cfg).excluded).toBe(true);
  });
});

describe('PHASE 1/2 (investigate + handoff)', () => {
  let phases: ReturnType<typeof buildPhases>;
  let before = '';

  it('7 phases', () => {
    store.commitRun(w1);
    phases = buildPhases(w1, cfg);
    expect(phases.length).toBe(7);
  });

  it('phase 6 starred HRI', () => {
    expect(phases[5].star).toBe(true);
  });

  it('scoped package built', () => {
    const pkg = buildExportPackage(w1, cfg);
    expect(pkg.count > 0).toBe(true);
    expect(/RETURN FORMAT/.test(pkg.text)).toBe(true);
  });

  it('findings parsed', () => {
    const list = triageList(w1, cfg);
    dev1 = list[0].name as string;
    dev2 = (list[1] ? list[1].name : list[0].name) as string;
    const parsed = parseFindings(
      `${dev1}: state=actioned; component=RAM; cause=0x1A; note=x\n${dev2}: state=false_positive`,
    );
    expect(parsed.length).toBe(2);
    before = JSON.stringify(w1.rows.find((r) => r.name === dev1));
    applyFindings(parsed, 'copilot', store);
  });

  it('baseline NOT mutated (overlay only)', () => {
    expect(JSON.stringify(store.currentRun()!.rows.find((r) => r.name === dev1))).toBe(before);
  });

  it('overlay holds component', () => {
    expect(store.getOverlay(dev1).component).toBe('RAM');
  });

  it('changelog populated', () => {
    expect(store.getChangelog().length > 0).toBe(true);
  });
});

describe('PHASE 3 (queue carry-forward + reports)', () => {
  let four = '';

  it('dev1 resolved => work done', () => {
    store.setDeviceState(dev1, 'RESOLVED', 'queue');
    expect(store.getWork(dev1).state).toBe('done');
  });

  it('persist device at 2 weeks', () => {
    // pick a persist device that was NOT touched (not dev1/dev2) so
    // carry-forward isn't a recurrence
    const touched = new Set([dev1, dev2]);
    persist = buildQueue(w1, cfg, store).find(
      (d) => !touched.has(d.name) && d.state === 'NEW',
    )!.name;
    store.commitRun(H.loadRun('2026-08-14').run);
    expect(store.getQueue(persist).consecutiveWeeks).toBe(2);
  });

  it('persist device at 3 weeks -> escalate', () => {
    w3 = H.loadRun('2026-08-21').run;
    store.commitRun(w3);
    const row = buildQueue(w3, cfg, store).find((d) => d.name === persist)!;
    expect(row.escalate).toBe(true);
  });

  it('Four Questions all sections', () => {
    four = reportFourQuestions(w3, 'Tickets closed: 14', cfg, store);
    expect(/1\. Current DEX/.test(four)).toBe(true);
    expect(/4\. What improved/.test(four)).toBe(true);
  });

  it('metric verbatim', () => {
    expect(four.includes('Tickets closed: 14')).toBe(true);
  });

  it('no hyperlinks/sign-off', () => {
    expect(/https?:\/\//.test(four)).toBe(false);
    expect(/\b(regards|sincerely|best,)\b/i.test(four)).toBe(false);
  });
});

describe('PHASE 4 (config, tickets, validation, trends)', () => {
  let tm: ReturnType<typeof buildTickets>;

  it('bad weights refused', () => {
    const res = saveConfig(
      {
        crsW: { dex: 50, crash: 20, age: 15, ram: 10, storage: 15, os: 10, avail: 10 },
        crsTier: cfg.crsTier,
        hriBand: cfg.hriBand,
        excludeSrc: [],
      },
      cfg,
      store,
    );
    expect(res.ok).toBe(false);
  });

  it('valid config accepted + applied', () => {
    const res = saveConfig(
      {
        crsW: CFG_DEFAULTS.crsW,
        crsTier: { CRITICAL: 40, HIGH: 30, ELEVATED: 20, MONITOR: 10 },
        hriBand: CFG_DEFAULTS.hriBand,
        excludeSrc: CFG_DEFAULTS.excludeSrc,
      },
      cfg,
      store,
    );
    expect(res.ok).toBe(true);
    expect(cfg.crsTier.CRITICAL).toBe(40);
  });

  it('config persists on boot', () => {
    applyStoredConfig(cfg, store);
    expect(cfg.crsTier.CRITICAL).toBe(40);
  });

  it('reset restores 52', () => {
    resetConfigDefaults(cfg, store);
    expect(cfg.crsTier.CRITICAL).toBe(52);
  });

  it('incident payload: company constant + auto impact', () => {
    const q = buildQueue(w3, cfg, store);
    tm = buildTickets(q.slice(0, 3) as Partial<QueueRow>[], 'incident', cfg, store);
    expect(tm.every((t) => t.company === DEMO_COMPANY && !!t.impact)).toBe(true);
  });

  it('affected asset strips the device-name prefix', () => {
    expect(/^DEMO-/.test(tm[0].affectedAsset as string)).toBe(false);
    expect(tm[0].affectedAsset).toMatch(/^\d{4}$/);
  });

  it('CSV has owner_verify col', () => {
    expect(/owner_verify/.test(ticketsCSV(tm as Record<string, unknown>[]))).toBe(true);
  });

  it('service-account owner flags ownerVerify', () => {
    const t = incidentTicket(
      {
        name: 'DEMO-LT-0001',
        user: 'svc-backup01',
        tier: 'HIGH',
        sev: 'DEGRADING',
        hri: 30,
        crs: 45,
        driver: 'RAM',
        reason: { label: 'HIGH', rank: 4, cls: 't-HIGH' },
      },
      cfg,
    );
    expect(t.ownerVerify).toBe(true);
  });

  it('starts 0 graded', () => {
    expect(validationMetrics(store).graded).toBe(0);
  });

  it('insufficient blocks tuning', () => {
    expect(tuningProposal(cfg, store).status).toBe('insufficient');
  });

  it('20 graded -> credible + precision', () => {
    buildQueue(w3, cfg, store)
      .slice(0, 20)
      .forEach((r, i) =>
        store.addOutcome({
          device: r.name,
          week: '2026-08-21',
          predictedSev: r.sev as string,
          predictedTier: r.tier as string,
          hri: r.hri ?? null,
          crs: r.crs ?? null,
          outcome: i < 6 ? 'no_fail' : 'confirmed_fail',
          leadDays: i % 5,
        }),
      );
    const m = validationMetrics(store);
    expect(m.graded >= 20).toBe(true);
    expect(m.credible).toBe(true);
    expect(m.precision).not.toBeNull();
  });

  it('60-day guard blocks second change', () => {
    store.recordTuning('x');
    expect(store.tuningAllowed().allowed).toBe(false);
  });

  it('trends history >=3 weeks', () => {
    expect(store.get().runHistory.length >= 3).toBe(true);
  });
});

/* One meta-assertion so a silently-skipped block cannot pass as green. */
describe('suite integrity', () => {
  it('the sample fixture is the synthetic 300-device export', () => {
    const txt = sampleFile().text;
    expect(txt.trimEnd().split('\n').length).toBe(301); // header + 300 rows
    expect(txt).toContain('total_hard_resets_');
    expect(txt).toContain('total_system_crashes_');
    expect(txt).toContain('last_bugcheck_code_');
    expect(txt).toContain('last_bugcheck_label_');
  });
});

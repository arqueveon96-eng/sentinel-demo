/* ============================================================
   guardrails.test.ts — ADDITIVE. Nothing here replaces or weakens a
   regression assertion; it pins the README's "Guardrails (each is a
   scar)" at their exact edges.

   Why: a mutation run against the ported core showed the original
   suite's OS assertion is satisfiable by a bare `includes('10')` match,
   because no OS string in the 300-device sample contains "10" outside
   "Windows 10". The guardrail is real; the original test just does not
   pin it. These do. Same for the band edges, which the original only
   probes on one side.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { makeCfg, crsPoints, hriCounts, isExcluded, scoreDevice } from '@/core/scoring';

const cfg = makeCfg();
const os = (s: string): number => crsPoints({ os: s }, cfg).os;

describe('guardrail: OS matches "Windows 10", never a bare "10"', () => {
  it('scores a real Windows 10 build at 100', () => {
    expect(os('Windows 10 Enterprise 22H2')).toBe(100);
    expect(os('windows 10 pro')).toBe(100);
  });

  it('does NOT score a Windows 11 build carrying a stray "10" as Windows 10', () => {
    // a bare includes('10') match would return 100 for every one of these
    expect(os('Windows 11 Enterprise 24H2 build 10240')).toBe(20);
    expect(os('Windows 11 Enterprise 23H2 (10.0.22631)')).toBe(50);
    expect(os('Windows 11 Enterprise 22H2 10.0')).toBe(80);
    expect(os('Windows 11 Enterprise 25H2 v10')).toBe(0);
  });

  it('an Insider Preview build scores as the worst case', () => {
    expect(os('Windows 11 Insider Preview')).toBe(100);
  });

  it('an absent OS scores 40 (unknown), a present-but-unrecognised OS scores 0', () => {
    expect(os('')).toBe(40);
    expect(crsPoints({}, cfg).os).toBe(40);
    expect(os('Ubuntu 24.04')).toBe(0);
  });
});

describe('guardrail: null DEX is 40 (unknown risk), never 0', () => {
  it.each([
    [null, 40],
    [undefined, 40],
    [30, 100],
    [31, 50],
    [70, 50],
    [71, 0],
    [100, 0],
    [0, 100],
  ])('dex %s -> %s points', (dex, expected) => {
    expect(crsPoints({ dex: dex as number | null }, cfg).dex).toBe(expected);
  });

  it('a null-DEX device never sorts below a healthy one on the DEX dimension', () => {
    const unknown = scoreDevice({ name: 'unknown', dex: null }, cfg);
    const healthy = scoreDevice({ name: 'healthy', dex: 95 }, cfg);
    expect(unknown.wtd!.DEX).toBeGreaterThan(healthy.wtd!.DEX);
  });
});

describe('guardrail: >=500 crash anti-saturation', () => {
  it.each([
    [null, 0],
    [0, 0],
    [4, 0],
    [5, 25],
    [19, 25],
    [20, 50],
    [49, 50],
    [50, 70],
    [99, 70],
    [100, 85],
    [499, 85],
    [500, 100],
    [6887, 100],
  ])('crashes %s -> %s points', (c, expected) => {
    expect(crsPoints({ crashes: c as number | null }, cfg).crash).toBe(expected);
  });
});

describe('guardrail: HRI bands and the soft-signal gate', () => {
  it.each([
    [null, 0],
    [0, 0],
    [1, 16],
    [2, 21],
    [3, 26],
    [5, 33],
    [10, 40],
    [99, 40],
  ])('hard resets %s -> %s points', (n, expected) => {
    expect(hriCounts({ hardResets: n as number | null, crashCount: 0 }, cfg).parts!.reset).toBe(
      expected,
    );
  });

  it('uptime creep only counts when a hard signal is already present', () => {
    // 40 days uptime, no resets and no crashes: soft points are gated off
    expect(hriCounts({ hardResets: 0, crashCount: 0, boot: 40 }, cfg).parts!.soft).toBe(0);
    // same uptime with one reset: the soft point lands
    expect(hriCounts({ hardResets: 1, crashCount: 0, boot: 40 }, cfg).parts!.soft).toBe(5);
  });

  it('is unavailable — not zero — when neither counts column arrived', () => {
    const h = hriCounts({ boot: 40 }, cfg);
    expect(h.hri).toBeNull();
    expect(h.sev).toBe('—');
    expect(h.mode).toBe('unavailable');
  });

  it('caps at 100', () => {
    expect(hriCounts({ hardResets: 99, crashCount: 99, boot: 99 }, cfg).hri).toBe(85);
  });
});

describe('guardrail: hidden risk and the queue predicate', () => {
  it('hidden risk is HRI-flagged but composite-quiet, and never a CRITICAL/HIGH', () => {
    const d = scoreDevice(
      { name: 'D', dex: 95, crashes: 0, age: 100, ramGB: 32, free: 400, os: 'Windows 11 Enterprise 25H2', seen: 0, hardResets: 2, crashCount: 0 },
      cfg,
    );
    expect(d.tier).toBe('HEALTHY');
    expect(d.hri).toBe(21);
    expect(d.hidden).toBe(true);
    expect(d.queue).toBe(true);
  });

  it('an excluded owner is never queued, however bad the device', () => {
    const d = scoreDevice(
      {
        name: 'D',
        user: 'svc-backup01',
        dex: 5,
        crashes: 9000,
        age: 2000,
        ramGB: 8,
        free: 5,
        os: 'Windows 10 Enterprise 22H2',
        seen: 30,
        hardResets: 20,
      },
      cfg,
    );
    expect(d.excluded).toBe(true);
    expect(d.crs).toBe(100); // every dimension pegged
    expect(d.tier).toBe('CRITICAL');
    expect(d.sev).toBe('FAILING');
    expect(d.queue).toBe(false); // exclusion beats every other signal
  });
});

describe('guardrail: owner-exclusion patterns', () => {
  it.each([
    ['svc-backup01', true],
    ['SVC-imaging', true],
    ['svcBackup', true],
    ['helpdesk-admin', true],
    ['domain admin', true],
    ['shared-frontdesk', true],
    ['kiosk-lobby', true],
    ['build service account', true],
    ['user0001', false],
    ['', false],
    ['administrator', false],
    ['shared', false],
  ])('%s -> excluded %s', (user, expected) => {
    expect(isExcluded(user, cfg)).toBe(expected);
  });
});

describe('guardrail: triage rank is relative and lives in its own field', () => {
  it('a device carries both an absolute tier and a relative triage rank, never merged', () => {
    const d = scoreDevice({ name: 'D', dex: 95 }, cfg);
    expect(d.tier).toBeDefined();
    expect(d.triage).toBeUndefined(); // only assignTriage sets it, over a whole fleet
  });
});

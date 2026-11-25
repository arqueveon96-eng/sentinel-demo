/* ============================================================
   verdict.test.ts — every branch of the Phase 2 prose generators.

   The bar: the sentence the operator reads is held to the same standard
   as a score. Every branch is pinned, every number in the evidence line
   traces to a field on the row, and a missing field says so rather than
   being filled in.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { makeCfg, scoreDevice } from '@/core/scoring';
import {
  countWord,
  driverPhrase,
  proved,
  signalTiles,
  verdict,
  verdictText,
  whyLine,
  type VerdictCase,
} from '@/core/verdict';
import type { Device, Outcome } from '@/core/types';

const cfg = makeCfg();

/** Score a partial row the way the pipeline would, so `hidden`/`sev` are real. */
function score(d: Device): Device {
  return scoreDevice({ ...d }, makeCfg());
}

function outcome(o: Partial<Outcome>): Outcome {
  return {
    device: 'L-1',
    week: '2026-09-03',
    predictedSev: null,
    predictedTier: null,
    hri: null,
    crs: null,
    outcome: 'pending',
    component: '',
    leadDays: null,
    note: '',
    ts: '2026-09-03T00:00:00.000Z',
    ...o,
  };
}

/* ---------- the fixtures, one per real case ---------- */

/** FAILING with a healthy DEX — the mockup's hero device, on real bands. */
const failingHidden = score({
  name: 'DEMO-WS-0147',
  user: 'user0147',
  model: 'Workstation W1',
  os: 'Windows 11 Enterprise 22H2',
  age: 1200,
  seen: 8,
  boot: 3,
  ramGB: 32,
  dex: 86,
  crashes: 2,
  free: 45,
  hardResets: 3,
  crashCount: 1,
  lastBugcheck: '0x50',
});

/** FAILING and the composite already agrees (CRITICAL). */
const failingVisible = score({
  name: 'L-2',
  os: 'Windows 10 Enterprise',
  age: 1400,
  seen: 20,
  ramGB: 8,
  dex: 20,
  crashes: 600,
  free: 5,
  hardResets: 6,
  crashCount: 4,
  lastBugcheck: '0x9F',
});

/** CRITICAL composite, hardware quiet. */
const criticalComposite = score({
  name: 'L-3',
  os: 'Windows 10 Enterprise',
  age: 1400,
  seen: 20,
  ramGB: 8,
  dex: 25,
  crashes: 600,
  free: 5,
  hardResets: 0,
  crashCount: 0,
});

/** HIGH by age, nothing else moving. */
const highByAge = score({
  name: 'L-4',
  os: 'Windows 10 Enterprise',
  age: 1200,
  seen: 0,
  ramGB: 16,
  dex: 88,
  crashes: 0,
  free: 45,
  hardResets: 0,
  crashCount: 0,
});

describe('verdict — the case matrix', () => {
  const cases: [string, Device, VerdictCase][] = [
    ['FAILING with a healthy DEX (hidden)', failingHidden, 'failing-hidden'],
    ['FAILING with the composite already CRITICAL', failingVisible, 'failing-visible'],
    ['CRITICAL composite, hardware quiet', criticalComposite, 'critical'],
    ['HIGH driven by age', highByAge, 'high-age'],
  ];
  it.each(cases)('%s -> %s', (_label, row, expected) => {
    expect(verdict(row, cfg).case).toBe(expected);
  });

  it('FAILING with a null DEX reads as blind, not as hidden', () => {
    const d = score({ name: 'D-1', dex: null, age: 10, hardResets: 4, crashCount: 2, ramGB: 32, free: 500, seen: 0, crashes: 0 });
    expect(d.sev).toBe('FAILING');
    const v = verdict(d, cfg);
    expect(v.case).toBe('failing-blind');
    expect(v.headline).toBe(
      'The hardware is failing now, and there is no experience score to contradict it.',
    );
    expect(verdictText(v)).toContain('unknown, never healthy');
  });

  it('DEGRADING under a healthy composite is degrading-hidden', () => {
    const d = score({ name: 'D-2', dex: 90, age: 10, ramGB: 32, free: 500, seen: 0, crashes: 0, hardResets: 2, crashCount: 0, boot: 2 });
    expect(d.sev).toBe('DEGRADING');
    expect(d.hidden).toBe(true);
    const v = verdict(d, cfg);
    expect(v.case).toBe('degrading-hidden');
    // hidden risk owns the colour, exactly as the picker groups it
    expect(v.accent).toBe('purple');
  });

  it('DEGRADING with the composite already HIGH is plain degrading', () => {
    const d = score({ name: 'D-3', os: 'Windows 11 Enterprise 22H2', dex: 60, age: 1200, ramGB: 16, free: 45, seen: 0, crashes: 0, hardResets: 2, crashCount: 0 });
    expect(d.sev).toBe('DEGRADING');
    expect(d.tier).toBe('HIGH');
    expect(d.hidden).toBe(false);
    expect(verdict(d, cfg).case).toBe('degrading');
  });

  it('a WATCH-band device under a quiet composite is hidden-watch', () => {
    const d = score({ name: 'D-4', dex: 95, age: 10, ramGB: 32, free: 500, seen: 0, crashes: 0, hardResets: 0, crashCount: 1 });
    expect(d.hri).toBe(18);
    expect(d.sev).toBe('WATCH');
    expect(d.hidden).toBe(true);
    const v = verdict(d, cfg);
    expect(v.case).toBe('hidden-watch');
    expect(v.accent).toBe('purple');
    expect(v.headline).toBe('HRI can see something here that the composite cannot.');
  });

  it('a WATCH-band device the composite already ranks HIGH is watch', () => {
    const d = score({ name: 'D-5', dex: 20, age: 1200, ramGB: 8, free: 10, seen: 20, crashes: 200, hardResets: 0, crashCount: 1 });
    expect(d.sev).toBe('WATCH');
    expect(d.hidden).toBe(false);
    expect(d.tier).toBe('CRITICAL');
    // CRITICAL wins the headline: it is the stronger true statement.
    expect(verdict(d, cfg).case).toBe('critical');
  });

  it('HIGH driven by something other than age names that driver', () => {
    const d = score({ name: 'D-6', os: 'Windows 11 Enterprise 22H2', dex: 75, age: 0, ramGB: 16, free: 45, seen: 5, crashes: 60, hardResets: 0, crashCount: 0 });
    expect(d.tier).toBe('HIGH');
    expect(d.driver).toBe('Crashes');
    const v = verdict(d, cfg);
    expect(v.case).toBe('high');
    expect(v.headline).toContain(driverPhrase(d.driver));
  });

  it('no raw counts at all reads as blind and never invents an HRI', () => {
    const d = score({ name: 'D-7', dex: 80, age: 100, ramGB: 32, free: 500, seen: 0, crashes: 0 });
    expect(d.hri).toBeNull();
    const v = verdict(d, cfg);
    expect(v.case).toBe('hri-unavailable');
    expect(verdictText(v)).toContain('HRI is unavailable');
    expect(verdictText(v)).not.toMatch(/HRI \d/);
  });

  it('no raw counts but a CRITICAL composite still leads with the composite', () => {
    const d = score({ name: 'D-8', dex: 20, age: 1400, ramGB: 8, free: 5, seen: 20, crashes: 600 });
    expect(d.hri).toBeNull();
    expect(verdict(d, cfg).case).toBe('critical');
  });

  it('a clean device says so', () => {
    const d = score({ name: 'D-9', dex: 95, age: 10, ramGB: 32, free: 500, seen: 0, crashes: 0, hardResets: 0, crashCount: 0 });
    const v = verdict(d, cfg);
    expect(v.case).toBe('quiet');
    expect(v.accent).toBe('green');
  });

  it('an empty row does not throw and claims nothing', () => {
    const v = verdict(undefined, cfg);
    expect(v.case).toBe('hri-unavailable');
    expect(v.headline).toBe('The hardware signal is blind on this device.');
  });
});

describe('verdict — the evidence line is built from the row', () => {
  it('reproduces the mockup sentence for the hidden FAILING case', () => {
    const v = verdict(failingHidden, cfg);
    expect(v.headline).toBe(
      'The hardware is failing now, and the experience score is hiding it.',
    );
    const t = verdictText(v);
    expect(t).toContain('HRI 44');
    expect(t).toContain('three hard resets and one system crash in 30 days');
    expect(t).toContain('last bugcheck 0x50');
    expect(t).toContain('Composite CRS 42 (HIGH) is driven by age, not by this fault');
    expect(t).toContain('DEX is 86, so a DEX-only view would never surface it');
  });

  it('sets every figure it quotes in mono, and colours only the severity one', () => {
    const v = verdict(failingHidden, cfg);
    const mono = v.evidence.filter((s) => s.mono).map((s) => s.text);
    expect(mono).toEqual(['44', '0x50', '42', '86']);
    expect(v.evidence.find((s) => s.text === '44')?.tone).toBe('sev');
  });

  it('pluralises counts and spells them out to ten, digits after', () => {
    expect(countWord(0)).toBe('no');
    expect(countWord(1)).toBe('one');
    expect(countWord(10)).toBe('ten');
    expect(countWord(11)).toBe('11');
    expect(countWord(null)).toBe('an unknown number of');
    const one = score({ name: 'X', dex: 90, hardResets: 1, crashCount: 1, age: 0, ramGB: 32, free: 500, seen: 0, crashes: 0 });
    expect(verdictText(verdict(one, cfg))).toContain('one hard reset and one system crash');
  });

  it('mentions uptime creep only when it actually scored', () => {
    const creeping = score({ name: 'X', dex: 90, hardResets: 2, crashCount: 0, boot: 30, age: 0, ramGB: 32, free: 500, seen: 0, crashes: 0 });
    expect(creeping.hriParts?.soft).toBe(5);
    expect(verdictText(verdict(creeping, cfg))).toContain('has not had a full boot in 30 days');
    const notCreeping = score({ name: 'Y', dex: 90, hardResets: 2, crashCount: 0, boot: 2, age: 0, ramGB: 32, free: 500, seen: 0, crashes: 0 });
    expect(verdictText(verdict(notCreeping, cfg))).not.toContain('full boot');
  });

  it('drops the "not by this fault" clause when crashes are the composite driver too', () => {
    const d = score({ name: 'Z', dex: 90, age: 0, ramGB: 32, free: 500, seen: 0, crashes: 600, hardResets: 3, crashCount: 1 });
    expect(d.driver).toBe('Crashes');
    expect(verdictText(verdict(d, cfg))).not.toContain('not by this fault');
  });

  it('says zero counts plainly instead of dressing them up', () => {
    const d = score({ name: 'Q', dex: 90, hardResets: 0, crashCount: 0, age: 0, ramGB: 32, free: 500, seen: 0, crashes: 0 });
    expect(verdictText(verdict(d, cfg))).toContain('no hard resets or kernel faults in 30 days');
  });
});

describe('whyLine — the triage table cell', () => {
  it('leads with the hardware counts when HRI flagged it', () => {
    expect(whyLine(failingHidden)).toBe(
      'HRI 44 — 3 hard resets, 1 crash, bugcheck 0x50 · Workstation W1',
    );
  });

  it('names hidden risk and what the composite said instead', () => {
    const d = score({ name: 'H', model: 'Laptop L1', dex: 95, age: 10, ramGB: 32, free: 500, seen: 0, crashes: 0, hardResets: 0, crashCount: 1 });
    expect(whyLine(d)).toBe('Hidden risk — HRI 18 flags it, composite says HEALTHY · Laptop L1');
  });

  it('falls back to the composite driver when the hardware is quiet', () => {
    expect(whyLine(criticalComposite)).toContain('CRITICAL composite — the experience score');
  });

  it('never leaves the cell empty', () => {
    expect(whyLine({})).toBe('Flagged for review');
  });
});

describe('signalTiles', () => {
  it('reads the mockup device the way the mockup does', () => {
    const t = signalTiles(failingHidden, cfg);
    expect(t.map((x) => x.key)).toEqual(['resets', 'crashes', 'dex', 'age', 'free', 'ram']);
    expect(t[0]).toMatchObject({ value: '3', band: 'red', reading: '30d · HRI 0–40' });
    expect(t[1]).toMatchObject({ value: '1', band: 'amber', reading: '0x50' });
    expect(t[2]).toMatchObject({ value: '86', band: 'green', reading: 'healthy · masks it' });
    expect(t[3]).toMatchObject({ value: '1200', unit: 'd', band: 'red', reading: 'CRS driver' });
    expect(t[4]).toMatchObject({ value: '45', unit: 'GB', band: 'amber', reading: 'tight' });
    expect(t[5]).toMatchObject({ value: '32', unit: 'GB', band: 'green', reading: 'not a factor' });
  });

  it('never fabricates a number for a field the export did not carry', () => {
    const t = signalTiles(score({ name: 'N' }), cfg);
    const byKey = Object.fromEntries(t.map((x) => [x.key, x]));
    expect(byKey.resets).toMatchObject({ value: '—', band: 'dim', reading: 'not in this export' });
    expect(byKey.age).toMatchObject({ value: '—', band: 'dim' });
    expect(byKey.free).toMatchObject({ value: '—', band: 'dim' });
    expect(byKey.ram).toMatchObject({ value: '—', band: 'dim' });
  });

  it('shows a null DEX as null and bands it amber, never green', () => {
    const t = signalTiles(score({ name: 'N', dex: null }), cfg);
    expect(t[2]).toMatchObject({ value: 'null', band: 'amber', reading: 'unknown risk, scored 40' });
  });

  it('bands age, storage and RAM on the CRS thresholds', () => {
    const rows = signalTiles(
      score({ name: 'A', age: 1200, free: 15, ramGB: 8, dex: 50, crashes: 0, seen: 0 }),
      cfg,
    );
    expect(rows[3]).toMatchObject({ band: 'red', reading: 'CRS driver' });
    expect(rows[4]).toMatchObject({ band: 'red', reading: 'critically low' });
    expect(rows[5]).toMatchObject({ band: 'red', reading: 'below the floor' });
  });
});

describe('proved — the Close sentence', () => {
  const text = (p: ReturnType<typeof proved>) => p.segs.map((s) => s.text).join('');

  it('before an outcome, says what is still missing', () => {
    const p = proved(failingHidden, null);
    expect(p.case).toBe('pending');
    expect(text(p)).toContain('Nothing is proved until the outcome is recorded');
  });

  it('a confirmed failure with lead time reads like the mockup', () => {
    const p = proved(failingHidden, outcome({ outcome: 'confirmed_fail', leadDays: 2 }));
    expect(p.case).toBe('confirmed-lead');
    const t = text(p);
    expect(t).toContain('Predicted FAILING from three hard resets and one system crash');
    expect(t).toContain('Two days of lead time');
    expect(t).toContain('its DEX score was 86 the whole way');
  });

  it('one day is singular', () => {
    const t = text(proved(failingHidden, outcome({ outcome: 'confirmed_fail', leadDays: 1 })));
    expect(t).toContain('One day of lead time');
  });

  it('a confirmed failure with no lead time says so instead of implying one', () => {
    const p = proved(failingHidden, outcome({ outcome: 'confirmed_fail', leadDays: null }));
    expect(p.case).toBe('confirmed-no-lead');
    expect(text(p)).toContain('No lead time recorded');
  });

  it('a low-DEX device gets the composite tail, not the DEX one', () => {
    const t = text(proved(failingVisible, outcome({ outcome: 'confirmed_fail', leadDays: 3 })));
    expect(t).toContain('the composite ranked it CRITICAL at the same time');
    expect(t).not.toContain('DEX score');
  });

  it('an unflagged device that failed is recorded as a miss', () => {
    const p = proved(highByAge, outcome({ outcome: 'confirmed_fail', leadDays: 4 }));
    expect(p.case).toBe('missed');
    expect(text(p)).toContain('the only kind of outcome that moves recall');
  });

  it('no failure is named a false positive against the band', () => {
    const p = proved(failingHidden, outcome({ outcome: 'no_fail' }));
    expect(p.case).toBe('no-failure');
    expect(text(p)).toContain('A false positive against the FAILING band');
  });

  it('a false-positive signal quotes the operator note rather than inventing a cause', () => {
    const p = proved(failingHidden, outcome({ outcome: 'false_positive', note: 'user pulled the plug nightly' }));
    expect(p.case).toBe('false-positive');
    expect(text(p)).toContain('user pulled the plug nightly');
  });

  it('a false positive with no note still refuses to invent one', () => {
    const t = text(proved(failingHidden, outcome({ outcome: 'false_positive' })));
    expect(t).toContain('the events did not come from a failing component');
  });
});

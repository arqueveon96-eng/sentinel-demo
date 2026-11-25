/* ============================================================
   verdict.ts — NEW in Phase 2. Pure, deterministic prose from a
   scored device row.

   Why this is in src/core/ and not in the UI: it is the same kind of
   thing reports.ts is — a deterministic string built from the committed
   run, with no DOM, no React and no I/O. It is the sentence the operator
   reads before deciding anything, so it is held to the same bar as a
   score: every number in it comes from the row, nothing is rounded into
   existence, and a missing field says so instead of being filled in.

   Nothing here is imported by an existing core module, and no existing
   module changed to make room for it.

   Three generators:
     verdict(row, cfg)                — the headline + evidence line
     signalTiles(row, cfg)            — the six tiles, with their readings
     proved(row, outcome, cfg)        — "what this one proved", after Close
   ============================================================ */

import type { Cfg, Device, Outcome, Sev } from './types';
import { fmt } from './format';

/* ---------- the segment model ----------
   The evidence line is not a string: the mockups set the numbers in
   mono and colour the ones that carry the verdict. So it is returned as
   typed segments and the view decides how to paint them. */

export type SegTone = 'plain' | 'sev' | 'ok' | 'dim' | 'strong';

export interface Seg {
  text: string;
  /** monospace + tabular numerals, as every identifier and figure is */
  mono?: boolean;
  tone?: SegTone;
}

/**
 * NOTE on the case list: there is deliberately no plain `watch` case.
 * `hidden` is defined as `hri >= hriBand.WATCH && tier is not CRITICAL/HIGH`
 * — the same threshold that produces sev WATCH. So a WATCH-band device is
 * always either hidden or already carried by the composite, and a standalone
 * "watch" branch would be unreachable. This codebase catalogues its dead
 * branches rather than shipping them.
 */
export type VerdictCase =
  | 'failing-hidden'
  | 'failing-blind'
  | 'failing-visible'
  | 'critical'
  | 'degrading-hidden'
  | 'degrading'
  | 'hidden-watch'
  | 'high-age'
  | 'high'
  | 'hri-unavailable'
  | 'quiet';

export interface Verdict {
  /** which branch produced this — the test suite pins every one */
  case: VerdictCase;
  headline: string;
  evidence: Seg[];
  /** the colour of the card's left rule: the strongest true signal */
  accent: 'red' | 'amber' | 'purple' | 'green';
}

/* ---------- small language helpers ---------- */

const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** Counting words up to ten, digits after — the way the mockups write them. */
export function countWord(n: number | null | undefined): string {
  if (n == null) return 'an unknown number of';
  if (n < 0 || n > 10 || !Number.isInteger(n)) return String(n);
  return WORDS[n];
}

function plural(n: number | null | undefined, one: string, many?: string): string {
  return n === 1 ? one : (many ?? one + 's');
}

/** The CRS driver key as a phrase that can sit inside a sentence. */
export function driverPhrase(driver: string | null | undefined): string {
  switch (driver) {
    case 'DEX':
      return 'the experience score';
    case 'Crashes':
      return 'crash volume';
    case 'Age':
      return 'age';
    case 'RAM':
      return 'installed memory';
    case 'Storage':
      return 'free disk space';
    case 'OS':
      return 'the OS build';
    case 'Availability':
      return 'how long it has been out of contact';
    default:
      return 'no single dimension';
  }
}

/** True when the CRS driver is a different fault from the one HRI found. */
function driverIsElsewhere(d: Device): boolean {
  return d.driver !== 'Crashes' && d.driver !== '—';
}

/* ---------- the hardware clause ---------- */

function hardwareClause(d: Device): Seg[] {
  const segs: Seg[] = [];
  if (d.hri == null) {
    segs.push({
      text: 'No raw event counts came through for this device, so HRI is unavailable — the hardware signal is blind here, and nothing below can stand in for it.',
    });
    return segs;
  }
  segs.push({ text: 'HRI ' });
  segs.push({ text: String(fmt(d.hri)), mono: true, tone: severityTone(d.sev) });
  const resets = d.hardResets;
  const crashes = d.crashCount;
  const bits: string[] = [];
  if (resets != null && resets > 0)
    bits.push(`${countWord(resets)} hard ${plural(resets, 'reset')}`);
  if (crashes != null && crashes > 0)
    bits.push(`${countWord(crashes)} system ${plural(crashes, 'crash', 'crashes')}`);
  if (bits.length) {
    segs.push({ text: ` — ${bits.join(' and ')} in 30 days` });
  } else if (resets == null && crashes == null) {
    segs.push({ text: ' — counted from the uptime signal alone' });
  } else {
    segs.push({ text: ' — no hard resets or kernel faults in 30 days' });
  }
  if (d.hriParts && d.hriParts.soft > 0)
    segs.push({ text: `, and it has not had a full boot in ${d.boot} days` });
  if (d.lastBugcheck) {
    segs.push({ text: ', last bugcheck ' });
    segs.push({ text: String(d.lastBugcheck), mono: true });
    if (d.bugcheckLabel) segs.push({ text: ` ${d.bugcheckLabel}` });
  }
  segs.push({ text: '. ' });
  return segs;
}

/* ---------- the composite clause ---------- */

function compositeClause(d: Device, flagged: boolean): Seg[] {
  const segs: Seg[] = [];
  segs.push({ text: 'Composite CRS ' });
  segs.push({ text: String(fmt(d.crs)), mono: true, tone: 'strong' });
  segs.push({ text: ` (${d.tier}) ` });
  if (d.driver === '—') {
    segs.push({ text: 'scores off no single dimension' });
  } else {
    segs.push({ text: `is driven by ${driverPhrase(d.driver)}` });
    if (flagged && driverIsElsewhere(d)) segs.push({ text: ', not by this fault' });
  }
  segs.push({ text: '; ' });
  return segs;
}

/* ---------- the DEX clause ---------- */

function dexClause(d: Device): Seg[] {
  const segs: Seg[] = [];
  if (d.dex == null) {
    segs.push({ text: 'DEX is ' });
    segs.push({ text: 'null', mono: true, tone: 'dim' });
    segs.push({
      text: ' — unknown, never healthy. It scores as unknown risk and it never disappears from a sort.',
    });
    return segs;
  }
  segs.push({ text: 'DEX is ' });
  segs.push({ text: String(fmt(d.dex)), mono: true, tone: d.dex > 70 ? 'ok' : 'plain' });
  const hardwareFlagged = d.sev === 'FAILING' || d.sev === 'DEGRADING' || !!d.hidden;
  if (hardwareFlagged && d.dex > 70) {
    segs.push({ text: ', so a DEX-only view would never surface it.' });
  } else if (d.dex > 70) {
    segs.push({ text: ', which reads healthy — it is not what put this here.' });
  } else if (d.dex > 30) {
    segs.push({ text: ', low enough that the experience layer sees it too.' });
  } else {
    segs.push({ text: ', which is bad enough on its own to explain the tier.' });
  }
  return segs;
}

function severityTone(sev: Sev | undefined): SegTone {
  return sev === 'FAILING' || sev === 'DEGRADING' ? 'sev' : 'plain';
}

function accentFor(d: Device): Verdict['accent'] {
  if (d.sev === 'FAILING' || d.tier === 'CRITICAL') return 'red';
  if (d.hidden) return 'purple';
  if (d.sev === 'DEGRADING' || d.tier === 'HIGH' || d.sev === 'WATCH') return 'amber';
  return 'green';
}

/* ---------- the headline ---------- */

/**
 * The headline follows the same precedence as dispatch (queueReason):
 * FAILING → HIDDEN → CRITICAL → DEGRADING → HIGH. The operator should never
 * read a verdict that disagrees with the order the queue put the machine in.
 */
function classify(d: Device, _cfg: Cfg): VerdictCase {
  if (d.sev === 'FAILING') {
    if (d.dex == null) return 'failing-blind';
    if (d.dex > 70) return 'failing-hidden';
    return 'failing-visible';
  }
  if (d.hidden) return d.sev === 'DEGRADING' ? 'degrading-hidden' : 'hidden-watch';
  if (d.tier === 'CRITICAL') return 'critical';
  if (d.sev === 'DEGRADING') return 'degrading';
  if (d.tier === 'HIGH') return d.driver === 'Age' ? 'high-age' : 'high';
  if (d.hri == null) return 'hri-unavailable';
  return 'quiet';
}

function headlineFor(kind: VerdictCase, d: Device): string {
  switch (kind) {
    case 'failing-hidden':
      return 'The hardware is failing now, and the experience score is hiding it.';
    case 'failing-blind':
      return 'The hardware is failing now, and there is no experience score to contradict it.';
    case 'failing-visible':
      return d.tier === 'CRITICAL' || d.tier === 'HIGH'
        ? `The hardware is failing, and the composite already ranks it ${d.tier}.`
        : `The hardware is failing, and the composite only reaches ${d.tier}.`;
    case 'critical':
      return `Composite risk is ${d.tier}, and ${driverPhrase(d.driver)} is what put it there.`;
    case 'degrading-hidden':
      return 'The hardware is starting to go, and nothing else in the stack has noticed.';
    case 'degrading':
      return 'The hardware is starting to go, and the composite is already carrying it.';
    case 'hidden-watch':
      return 'HRI can see something here that the composite cannot.';
    case 'high-age':
      return 'Nothing is broken yet. This machine is simply old enough to be next.';
    case 'high':
      return `Composite risk is HIGH, and ${driverPhrase(d.driver)} is what put it there.`;
    case 'hri-unavailable':
      return 'The hardware signal is blind on this device.';
    case 'quiet':
      return 'Nothing on this machine is flagged.';
  }
}

/**
 * The verdict card's sentence and evidence line, computed from the row.
 * `row` is the effective row — apply the store overlay before calling if
 * the operator has recorded a finding.
 */
export function verdict(row: Device | null | undefined, cfg: Cfg): Verdict {
  const d = row || {};
  const kind = classify(d, cfg);
  const flagged = d.hri != null && d.hri >= cfg.hriBand.WATCH;
  const evidence: Seg[] = [
    ...hardwareClause(d),
    ...compositeClause(d, flagged),
    ...dexClause(d),
  ];
  return {
    case: kind,
    headline: headlineFor(kind, d),
    evidence,
    accent: accentFor(d),
  };
}

/** The evidence line as plain text — for copy buttons and for tests. */
export function verdictText(v: Verdict): string {
  return v.evidence.map((s) => s.text).join('');
}

/**
 * The triage table's WHY IT IS HERE cell: one line, the shortest true
 * reason this device is in the queue. Same facts as the verdict, in a
 * cell's worth of room.
 */
export function whyLine(row: Device | null | undefined): string {
  const d = row || {};
  const bits: string[] = [];
  if (d.sev === 'FAILING' || d.sev === 'DEGRADING') {
    const parts: string[] = [];
    if (d.hardResets) parts.push(`${d.hardResets} hard ${plural(d.hardResets, 'reset')}`);
    if (d.crashCount) parts.push(`${d.crashCount} ${plural(d.crashCount, 'crash', 'crashes')}`);
    if (d.lastBugcheck) parts.push(`bugcheck ${d.lastBugcheck}`);
    bits.push(`HRI ${fmt(d.hri)} — ${parts.length ? parts.join(', ') : 'raw counts'}`);
    if (d.hidden) bits.push(`composite only ${d.tier}`);
  } else if (d.hidden) {
    bits.push(`Hidden risk — HRI ${fmt(d.hri)} flags it, composite says ${d.tier}`);
  } else if (d.tier === 'CRITICAL' || d.tier === 'HIGH') {
    bits.push(`${d.tier} composite — ${driverPhrase(d.driver)}`);
  } else {
    bits.push('Flagged for review');
  }
  if (d.model) bits.push(d.model);
  return bits.join(' · ');
}

/* ============================================================
   The six signal tiles
   ============================================================ */

export type Band = 'red' | 'amber' | 'green' | 'dim';

export interface SignalTile {
  key: 'resets' | 'crashes' | 'dex' | 'age' | 'free' | 'ram';
  /** the number, already formatted — '—' when the export did not carry it */
  value: string;
  /** the unit that trails the number, set smaller ('d', 'GB') */
  unit?: string;
  label: string;
  /** the one-line reading under the label */
  reading: string;
  band: Band;
}

export function signalTiles(row: Device | null | undefined, cfg: Cfg): SignalTile[] {
  const d = row || {};
  const missing = 'not in this export';

  /* hard resets */
  const hr = d.hardResets;
  const resets: SignalTile = {
    key: 'resets',
    value: hr == null ? '—' : String(hr),
    label: 'Hard resets',
    reading: hr == null ? missing : '30d · HRI 0–40',
    band: hr == null ? 'dim' : hr >= 3 ? 'red' : hr >= 1 ? 'amber' : 'green',
  };

  /* system crashes */
  const cc = d.crashCount;
  const crashes: SignalTile = {
    key: 'crashes',
    value: cc == null ? '—' : String(cc),
    label: 'System crashes',
    reading: cc == null ? missing : d.lastBugcheck ? String(d.lastBugcheck) : '30d · no bugcheck code',
    band: cc == null ? 'dim' : cc >= 2 ? 'red' : cc >= 1 ? 'amber' : 'green',
  };

  /* DEX. "masks it" is only true when the hardware signal disagrees. */
  const dx = d.dex;
  const masking = d.sev === 'FAILING' || d.sev === 'DEGRADING' || !!d.hidden;
  const dex: SignalTile = {
    key: 'dex',
    value: dx == null ? 'null' : String(fmt(dx)),
    label: 'DEX',
    reading:
      dx == null
        ? 'unknown risk, scored 40'
        : dx > 70
          ? masking
            ? 'healthy · masks it'
            : 'healthy'
          : dx > 30
            ? 'degraded'
            : 'severe',
    band: dx == null ? 'amber' : dx > 70 ? 'green' : dx > 30 ? 'amber' : 'red',
  };

  /* age */
  const ag = d.age;
  const age: SignalTile = {
    key: 'age',
    value: ag == null ? '—' : String(ag),
    unit: ag == null ? undefined : 'd',
    label: 'Age',
    reading:
      ag == null
        ? missing
        : d.driver === 'Age'
          ? 'CRS driver'
          : ag > 1095
            ? 'over 3 years'
            : ag > 730
              ? '2–3 years'
              : ag > 365
                ? '1–2 years'
                : 'under a year',
    band: ag == null ? 'dim' : ag > 1095 ? 'red' : ag > 730 ? 'amber' : ag > 365 ? 'amber' : 'green',
  };

  /* free space */
  const fr = d.free;
  const free: SignalTile = {
    key: 'free',
    value: fr == null ? '—' : String(fmt(fr)),
    unit: fr == null ? undefined : 'GB',
    label: 'Free space',
    reading:
      fr == null
        ? missing
        : fr < 20
          ? 'critically low'
          : fr < 50
            ? 'tight'
            : fr < 100
              ? 'inside the lowest band'
              : 'above all bands',
    band: fr == null ? 'dim' : fr < 20 ? 'red' : fr < 50 ? 'amber' : fr < 100 ? 'amber' : 'green',
  };

  /* RAM */
  const rm = d.ramGB;
  const ram: SignalTile = {
    key: 'ram',
    value: rm == null ? '—' : String(fmt(rm)),
    unit: rm == null ? undefined : 'GB',
    label: 'RAM',
    reading:
      rm == null
        ? missing
        : rm <= 8
          ? 'below the floor'
          : rm <= 16
            ? 'thin for this workload'
            : 'not a factor',
    band: rm == null ? 'dim' : rm <= 8 ? 'red' : rm <= 16 ? 'amber' : 'green',
  };

  void cfg;
  return [resets, crashes, dex, age, free, ram];
}

/* ============================================================
   "What this one proved" — the Close stage's sentence
   ============================================================ */

export type ProvedCase =
  | 'confirmed-lead'
  | 'confirmed-no-lead'
  | 'missed'
  | 'no-failure'
  | 'false-positive'
  | 'pending';

export interface Proved {
  case: ProvedCase;
  segs: Seg[];
}

/** The signals HRI actually fired on, as a phrase. */
function signalPhrase(d: Device): string {
  const bits: string[] = [];
  if (d.hardResets != null && d.hardResets > 0)
    bits.push(`${countWord(d.hardResets)} hard ${plural(d.hardResets, 'reset')}`);
  if (d.crashCount != null && d.crashCount > 0)
    bits.push(`${countWord(d.crashCount)} system ${plural(d.crashCount, 'crash', 'crashes')}`);
  if (d.lastBugcheck) bits.push(`a ${d.lastBugcheck} bugcheck`);
  if (!bits.length) return 'the counts in this week’s export';
  return bits.join(' and ');
}

function leadWord(n: number): string {
  const w = countWord(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * The sentence under WHAT THIS ONE PROVED. Written from the row and the
 * recorded outcome; before an outcome exists it says what is still missing
 * rather than guessing at it.
 */
export function proved(
  row: Device | null | undefined,
  outcome: Outcome | null | undefined,
): Proved {
  const d = row || {};
  const predicted = (d.sev as string) || '—';
  const wasFlagged = predicted === 'FAILING' || predicted === 'DEGRADING';

  if (!outcome || outcome.outcome === 'pending') {
    return {
      case: 'pending',
      segs: [
        { text: 'Predicted ' },
        { text: predicted, tone: severityTone(d.sev) },
        { text: ` from ${signalPhrase(d)}. ` },
        {
          text: 'Nothing is proved until the outcome is recorded — that is the only thing that turns HRI from a heuristic into a prediction.',
        },
      ],
    };
  }

  const lead = outcome.leadDays;
  const dexTail: Seg[] =
    d.dex != null && d.dex > 70
      ? [
          { text: ' — its DEX score was ' },
          { text: String(fmt(d.dex)), mono: true, tone: 'ok' },
          { text: ' the whole way.' },
        ]
      : [
          { text: ' — the composite ranked it ' },
          { text: String(d.tier ?? '—'), tone: 'strong' },
          { text: ' at the same time.' },
        ];

  if (outcome.outcome === 'confirmed_fail') {
    if (!wasFlagged) {
      return {
        case: 'missed',
        segs: [
          { text: 'HRI read this as ' },
          { text: predicted, tone: 'plain' },
          {
            text: ' and it failed anyway. A miss — the only kind of outcome that moves recall, and the reason the bands are still provisional.',
          },
        ],
      };
    }
    if (lead == null || lead <= 0) {
      return {
        case: 'confirmed-no-lead',
        segs: [
          { text: 'Predicted ' },
          { text: predicted, tone: severityTone(d.sev) },
          { text: ` from ${signalPhrase(d)}, and it failed. ` },
          {
            text: 'No lead time recorded, so this one counts toward precision but not toward the lead-time figure.',
          },
        ],
      };
    }
    return {
      case: 'confirmed-lead',
      segs: [
        { text: 'Predicted ' },
        { text: predicted, tone: severityTone(d.sev) },
        { text: ` from ${signalPhrase(d)}. Confirmed failed. ` },
        { text: `${leadWord(lead)} ${plural(lead, 'day')} of lead time`, tone: 'strong' },
        { text: ' that a DEX-only view would not have given you' },
        ...dexTail,
      ],
    };
  }

  if (outcome.outcome === 'no_fail') {
    return {
      case: 'no-failure',
      segs: [
        { text: 'Predicted ' },
        { text: predicted, tone: severityTone(d.sev) },
        { text: ` from ${signalPhrase(d)}, and it did not fail. ` },
        {
          text: `A false positive against the ${predicted} band. It pulls precision down, which is exactly why it gets recorded instead of forgotten.`,
        },
      ],
    };
  }

  /* false_positive: the signal itself was not real */
  return {
    case: 'false-positive',
    segs: [
      { text: 'The signal was not hardware: ' },
      { text: outcome.note || 'the events did not come from a failing component', tone: 'dim' },
      {
        text: '. Recorded so the bands stop trusting this shape — the counts were real, the conclusion was not.',
      },
    ],
  };
}

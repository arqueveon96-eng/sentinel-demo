/* ============================================================
   phases.ts — the seven FLEET-LEVEL investigation phases, as cards
   the operator can actually run.

   These questions are about the fleet — "what shape is the fleet in",
   "which desktops are invisible to DEX" — not about the one machine in
   the dossier, so they live in their own sheet. This module supplies
   everything the sheet shows that is not already computed by
   `buildPhases()`: the query to copy, how to read what comes back, and
   the write-back template.

   The queries are ILLUSTRATIVE (see nql.ts): short, generic NQL
   sketches scoped to a placeholder entity. P2, P6 and P7 come from
   nql.ts; P1, P3, P4 and P5 are below. P4 doubles as documentation of
   the export this console ingests, and phases.test.ts asserts that every
   column it computes is one `ingest.ts` actually reads — so the query
   and the ingester cannot drift apart.

   P6 is first and marked READ FIRST: a DEX-ineligible desktop has no
   experience score at all, so it is invisible to every composite view
   until you have that list in front of you.

   Pure: deterministic string building. No scoring, no I/O.
   ============================================================ */

import { SCOPE, p2Query, p6Query, p7Query } from './nql';

const scoped = (window: string, ...body: string[]): string =>
  [`devices during ${window}`, ...SCOPE, ...body].join('\n');

/** Phase 1 — Fleet baseline & DEX overview. */
export const P1_QUERY = scoped(
  'past 30d',
  '| include dex.scores during past 24h',
  '| compute dex_score_ = score.value.avg()',
  '| list device.name, device.hardware.model, device.operating_system.name, dex_score_',
  '| sort dex_score_ asc',
);

/** Phase 3 — Hardware performance telemetry (the pressure layer). */
export const P3_QUERY = scoped(
  'past 30d',
  '| include device_performance.events during past 30d',
  '| compute',
  '    normalized_cpu_usage_ = event.normalized_cpu_usage.avg(),',
  '    disk_read_latency_ms_ = event.disk_read_latency.avg()',
  '| list device.name, device.hardware.model, normalized_cpu_usage_, disk_read_latency_ms_',
  '| sort normalized_cpu_usage_ desc',
);

/** Phase 4 — the weekly CRS export: every column the console scores on. */
export const P4_QUERY = scoped(
  'past 30d',
  '| include dex.scores during past 24h',
  '| compute dex_score_ = score.value.avg()',
  '| include execution.crashes during past 30d',
  '| compute number_of_crashes_ = crash.number_of_crashes.sum()',
  '| include device_performance.hard_resets during past 30d',
  '| compute total_hard_resets_ = hard_reset.number_of_hard_resets.sum()',
  '| include device_performance.system_crashes during past 30d',
  '| compute',
  '    total_system_crashes_ = system_crash.number_of_system_crashes.sum(),',
  '    last_bugcheck_code_   = system_crash.error_code_hexadecimal.last()',
  '| include device_performance.events during past 30d',
  '| compute system_drive_free_space_gb_ = event.system_drive_free_space.avg() / 1073741824',
  '| list device.name, device.login.last_login_user_name, device.hardware.model,',
  '    device.operating_system.name, device.hardware.memory, device.days_since_first_seen,',
  '    device.days_since_last_seen, device.boot.days_since_last_full_boot, dex_score_,',
  '    number_of_crashes_, system_drive_free_space_gb_, total_hard_resets_,',
  '    total_system_crashes_, last_bugcheck_code_',
);

/** The placeholder P5 carries until a week is substituted in. */
export const P5_DATE_PLACEHOLDER = 'on <MONDAY>';

/** Phase 5 — DEX time series (one weekly snapshot per run). */
export const P5_QUERY = scoped(
  'past 90d',
  `| include dex.scores ${P5_DATE_PLACEHOLDER}`,
  '| compute dex_score_ = score.value.avg()',
  '| list device.name, device.hardware.model, dex_score_',
  '| sort dex_score_ asc',
);

/**
 * P5 is a weekly snapshot: the operator substitutes the Monday of the
 * week being captured. `weekEnding` is a Friday in this console, so the
 * Monday four days earlier is the one to ask for.
 */
export function p5Query(dateISO?: string | null): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dateISO ?? '')) ? String(dateISO) : null;
  return d ? P5_QUERY.replace(P5_DATE_PLACEHOLDER, `on ${d}`) : P5_QUERY;
}

/** weekEnding (a Friday) -> the Monday of that week, for P5. */
export function mondayOf(weekEnding: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(weekEnding ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // back up to the Monday on or before this date
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export type PhaseId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7';

export interface FleetPhase {
  id: PhaseId;
  /** 1-7 — also the key `Store.savePhaseNote` has always used */
  n: number;
  title: string;
  question: string;
  /** the one that has to be read before the others mean anything */
  readFirst?: boolean;
  query: string;
  /** what the returned columns actually tell you */
  howToRead: string;
  /** what to write in the note field, so next week's operator can use it */
  writeBack: string;
}

/**
 * The seven, in the order the operator should meet them: P6 first
 * because a device with no DEX score cannot appear in any composite
 * view, then the numeric order.
 */
export function fleetPhases(weekEnding?: string | null): FleetPhase[] {
  const all: Record<PhaseId, FleetPhase> = {
    P6: {
      id: 'P6',
      n: 6,
      title: 'DEX-ineligible devices',
      question: 'Which machines does the experience score never see?',
      readFirst: true,
      query: p6Query(),
      howToRead:
        'Every row has score_count_ 0 — Nexthink computed no DEX score for it in the last 24h. ' +
        'These are usually unattended desktops. They read STABLE in any DEX-driven view because ' +
        'there is nothing to read, so HRI raw counts are the only signal that reaches them. Count ' +
        'them before you quote a fleet DEX average: they are not in it.',
      writeBack:
        'How many, what hardware type, and whether the count moved since last week. Name the ones ' +
        'that also carry hard resets — those are the ones nothing else in the stack will surface.',
    },
    P1: {
      id: 'P1',
      n: 1,
      title: 'Fleet baseline',
      question: 'What shape is the fleet in?',
      query: P1_QUERY,
      howToRead:
        'dex_score_ is the figure you report; sorted ascending, the weakest devices come first. ' +
        'Sanity-check the device count against the export before you trust anything ' +
        'downstream — a short pull looks like an improvement.',
      writeBack:
        'The DEX figure you will quote, the device count it was computed over, and anything that ' +
        'makes this week not comparable to last week.',
    },
    P2: {
      id: 'P2',
      n: 2,
      title: 'Raw stability counts',
      question: 'What actually failed, unsaturated?',
      query: p2Query(),
      howToRead:
        'total_hard_resets_ and total_system_crashes_ are event counts, not subscores, so they do ' +
        'not saturate: 3 resets and 2 BSODs read as 3 and 2, and HRI adds them to 54 — FAILING. ' +
        'last_bugcheck_code_ is the component clue; verify any code-to-component mapping against ' +
        'the vendor reference before you act on it.',
      writeBack:
        'The devices at the top of the reset sort that are NOT already in the queue, and any ' +
        'bugcheck code appearing on more than one machine.',
    },
    P3: {
      id: 'P3',
      n: 3,
      title: 'Hardware performance telemetry',
      question: 'What is under pressure — CPU, memory or disk?',
      query: P3_QUERY,
      howToRead:
        'This is the pressure layer, not the failure layer: sustained CPU load or high disk ' +
        'latency explains a slow machine, it does not predict a dead one. Use it to tell "this ' +
        'device is undersized" apart from "this device is failing".',
      writeBack:
        'Which model or build shows the pressure, and whether it points at a spec problem rather ' +
        'than a fault.',
    },
    P4: {
      id: 'P4',
      n: 4,
      title: 'CRS export',
      question: 'Is the weekly export complete?',
      query: P4_QUERY,
      howToRead:
        'This is the export this console ingests. Every CRS input is in it, and both HRI count ' +
        'columns (total_hard_resets_, total_system_crashes_) are separate from number_of_crashes_, ' +
        'which is CRS crash volume. If HRI mode comes back anything but "counts" on the Pull ' +
        'stage, this query is where the missing column is.',
      writeBack:
        'Row count, and any column that came back empty. A missing column here is a false STABLE ' +
        'on every device next week.',
    },
    P5: {
      id: 'P5',
      n: 5,
      title: 'DEX time series',
      question: 'Which way is the fleet moving?',
      query: p5Query(mondayOf(weekEnding)),
      howToRead:
        'One row per device for the date in the query. Run it once per week with that ' +
        'Monday substituted and stack the exports — a single run of this query is ' +
        'a snapshot, not a trend. The console keeps its own week-over-week series from committed ' +
        'runs; this is the device-level version underneath it.',
      writeBack:
        'The direction, and the devices that moved most. A fleet average that holds still while ' +
        'individual devices swing is worth writing down.',
    },
    P7: {
      id: 'P7',
      n: 7,
      title: 'Single-device deep dive',
      question: 'What is going on with this one machine?',
      query: p7Query('<DEVICE_NAME>'),
      howToRead:
        'The per-device version of everything above. The Investigate stage fills the device name ' +
        'in for you on the machine in the dossier; this copy carries the <DEVICE_NAME> placeholder ' +
        'for a device that is not in the queue.',
      writeBack:
        'Use the per-device finding box in Investigate for a queued machine. Note here only what ' +
        'the deep dive said about the fleet — a firmware level, a driver, a shared cause.',
    },
  };
  return [all.P6, all.P1, all.P2, all.P3, all.P4, all.P5, all.P7];
}

/** The line the operator pastes back, in the format `parseFindings` reads. */
export const PHASE_WRITE_BACK_HINT =
  'Plain prose. This note is stored on the committed run and shown here again next time you open it.';

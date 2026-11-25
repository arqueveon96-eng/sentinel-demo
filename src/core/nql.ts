/* ============================================================
   nql.ts — the investigation queries the operator copies.

   ILLUSTRATIVE ONLY. These are short, generic sketches in Nexthink's
   query language (NQL) that show the shape of each question: a scope,
   a time window, and the raw counts HRI is built on. They are not a
   production query suite. The scope is a placeholder entity
   ("demo-entity"); adapt the scope and fields to your own tenant.

   The console needs three of them as *text a button can copy*:

     P7 — the single-device deep dive, with the device name substituted.
     P6 — the DEX-ineligible sweep, which the Investigate stage tells the
          operator to read first.
     P2 — raw stability counts, the every-investigation query.

   Deterministic string building. No scoring, no I/O.
   ============================================================ */

/** The placeholder scope every fleet query is locked to. */
export const DEMO_ENTITY = 'demo-entity';

export const SCOPE = [
  `| where device.entity == "${DEMO_ENTITY}"`,
  '| where device.hardware.type != virtual',
];

/** A device name is interpolated into a quoted NQL literal, so quotes go. */
export function nqlLiteral(name: string | null | undefined): string {
  return String(name ?? '').replace(/["\\]/g, '');
}

/** Phase 7 — single-device deep dive, name already filled in. */
export function p7Query(device: string | null | undefined): string {
  return [
    'devices during past 30d',
    `| where device.name == "${nqlLiteral(device)}"`,
    '| include device_performance.hard_resets during past 30d',
    '| compute total_hard_resets_ = hard_reset.number_of_hard_resets.sum()',
    '| include device_performance.system_crashes during past 30d',
    '| compute',
    '    total_system_crashes_ = system_crash.number_of_system_crashes.sum(),',
    '    last_bugcheck_code_   = system_crash.error_code_hexadecimal.last()',
    '| list device.name, device.hardware.model, total_hard_resets_,',
    '    total_system_crashes_, last_bugcheck_code_',
  ].join('\n');
}

/** Phase 6 — DEX-ineligible devices. Read first: they are invisible to CRS. */
export function p6Query(): string {
  return [
    'devices during past 7d',
    ...SCOPE,
    '| include dex.scores during past 24h',
    '| compute score_count_ = count()',
    '| list device.name, device.hardware.type, device.hardware.model, score_count_',
    '| where score_count_ == 0',
  ].join('\n');
}

/** Phase 2 — raw stability counts. What actually failed, unsaturated. */
export function p2Query(): string {
  return [
    'devices during past 30d',
    ...SCOPE,
    '| include device_performance.hard_resets during past 30d',
    '| compute total_hard_resets_ = hard_reset.number_of_hard_resets.sum()',
    '| include device_performance.system_crashes during past 30d',
    '| compute',
    '    total_system_crashes_ = system_crash.number_of_system_crashes.sum(),',
    '    last_bugcheck_code_   = system_crash.error_code_hexadecimal.last()',
    '| list device.name, device.hardware.model, total_hard_resets_,',
    '    total_system_crashes_, last_bugcheck_code_',
    '| sort total_hard_resets_ desc',
  ].join('\n');
}

export interface PhaseQuery {
  id: 'P6' | 'P2' | 'P7';
  title: string;
  when: string;
  text: string;
}

/** The three queries the Investigate stage puts in front of the operator. */
export function investigationQueries(device: string | null | undefined): PhaseQuery[] {
  return [
    { id: 'P6', title: 'DEX-ineligible devices', when: 'read first', text: p6Query() },
    { id: 'P2', title: 'Raw stability counts — what actually failed', when: 'every investigation', text: p2Query() },
    {
      id: 'P7',
      title: 'Single-device deep dive',
      when: 'any CRITICAL / FAILING',
      text: p7Query(device),
    },
  ];
}

/** The one line the operator pastes back, in the format parseFindings reads. */
export const FINDING_FORMAT =
  'state=<triaged|actioned|resolved|deferred|false_positive>; component=<x>; cause=<x>; action=<x>; owner=<x>; note=<x>';

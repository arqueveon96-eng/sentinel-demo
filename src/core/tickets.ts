/* ============================================================
   tickets.ts — ticket drafts built from evidence. Drafts only:
   Sentinel never submits anything to any system.

   Two shapes:
     • Incident — a generic ticketing-system incident (summary,
       description, impact/urgency) for whatever ITSM tool you use.
     • Proactive Ticket — a 13-field proactive-remediation form,
       pre-filled from the committed run, every value a suggestion
       the operator can override.

   The owner's display name is never invented: the export carries an
   owner ID only, so that field is left for the operator.

   Pure: no I/O, no DOM. `Cfg` and the store are explicit parameters.
   ============================================================ */

import type { Cfg, QueueRow, StoreApi } from './types';
import { fmt } from './format';
import { isExcluded } from './scoring';

/* ---------- Proactive Ticket vocabulary ---------- */
export const PROACTIVE_PRODUCTS = [
  'Laptop',
  'Rugged Laptop',
  'Rugged Tablet',
  'Tablet',
  'Desktop',
  'Workstation',
  'Video Appliance',
  'Other',
] as const;
export const PROACTIVE_CATEGORIES = [
  'Device reliability',
  'Device performance',
  'Boot & logon',
  'Software reliability',
  'Network',
  'OS servicing',
  'Firmware',
] as const;
export const PROACTIVE_REMEDIATIONS = [
  'Application repair',
  'Firmware update',
  'Hardware repair',
  'Reboot',
  'Reimage',
  'Remote action',
  'Other',
] as const;
export const PROACTIVE_DELIVERY = ['Remote', 'On-site', 'Depot swap'] as const;
export const PROACTIVE_LEVELS = ['High', 'Medium', 'Low'] as const;
/* Proactive fleet work is remote by default. */
export const PROACTIVE_DELIVERY_DEFAULT = 'Remote';

/** The neutral organisation name the incident payload carries in this demo. */
export const DEMO_COMPANY = 'demo-entity';

export interface ProactiveField {
  key: string;
  label: string;
  required: boolean;
  kind: string;
  options?: readonly string[];
}

/* The 13 fields, in form order. `key` is the payload/CSV key, `label` is
   what the form shows. Required = 11 of them (Asset tag and Additional
   information are optional). */
export const PROACTIVE_FIELDS: ProactiveField[] = [
  { key: 'ownerId', label: 'Owner ID', required: true, kind: 'text' },
  { key: 'ownerName', label: 'Owner name', required: true, kind: 'text' },
  { key: 'identifiedDate', label: 'Date identified', required: true, kind: 'date' },
  { key: 'deviceName', label: 'Device name', required: true, kind: 'text' },
  { key: 'product', label: 'Device category', required: true, kind: 'list', options: PROACTIVE_PRODUCTS },
  { key: 'category', label: 'Issue category', required: true, kind: 'radio', options: PROACTIVE_CATEGORIES },
  {
    key: 'remediation',
    label: 'Proposed remediation',
    required: true,
    kind: 'radio',
    options: PROACTIVE_REMEDIATIONS,
  },
  { key: 'summary', label: 'Summary', required: true, kind: 'textarea' },
  { key: 'deliveryMode', label: 'Delivery mode', required: true, kind: 'radio', options: PROACTIVE_DELIVERY },
  { key: 'impact', label: 'Impact', required: true, kind: 'select', options: PROACTIVE_LEVELS },
  { key: 'urgency', label: 'Urgency', required: true, kind: 'select', options: PROACTIVE_LEVELS },
  { key: 'assetTag', label: 'Asset tag', required: false, kind: 'text' },
  { key: 'additionalInfo', label: 'Additional information', required: false, kind: 'textarea' },
];
export const PROACTIVE_LABELS: Record<string, string> = PROACTIVE_FIELDS.reduce(
  (o, f) => {
    o[f.key] = f.label;
    return o;
  },
  {} as Record<string, string>,
);

/* ---------- Device category from the model string ----------
   A small keyword table. Evaluation order matters: the specific form
   factors (rugged tablet) are tested before the general ones (tablet).
   Anything unrecognised is left for the operator rather than guessed. */
const PRODUCT_RULES: { test: RegExp; product: string; why: string }[] = [
  { test: /rugged.*tablet|tablet.*rugged/, product: 'Rugged Tablet', why: 'rugged tablet form factor' },
  { test: /rugged/, product: 'Rugged Laptop', why: 'rugged laptop form factor' },
  { test: /video appliance|\bnvr\b/, product: 'Video Appliance', why: 'video recording appliance' },
  { test: /workstation|tower/, product: 'Workstation', why: 'workstation-class desktop' },
  { test: /desktop|micro|mini pc/, product: 'Desktop', why: 'desktop form factor' },
  { test: /laptop|notebook/, product: 'Laptop', why: 'clamshell laptop' },
  { test: /tablet|2-in-1|detachable/, product: 'Tablet', why: 'tablet / detachable form factor' },
];

export function mapModelToProduct(model: string | null | undefined): {
  product: string;
  why: string;
} {
  if (!model) return { product: '', why: 'no model — pick manually' };
  const m = model.toLowerCase();
  for (const rule of PRODUCT_RULES) {
    if (rule.test.test(m)) return { product: rule.product, why: rule.why };
  }
  return { product: '', why: 'model not in the category table — pick manually' };
}

/* ---------- CRS driver -> suggested issue category ----------
   `reasonKey` is the lowercased CRS driver (crashes / dex / age / ram /
   storage / os / availability). See proactiveReasonKey(). */
export function suggestCategory(reasonKey: string | null | undefined): string {
  const r = (reasonKey || '').toLowerCase();
  if (r === 'crashes') return 'Device reliability';
  if (r === 'dex' || r === 'ram' || r === 'storage') return 'Device performance';
  if (r === 'availability') return 'Boot & logon';
  if (r === 'os') return 'OS servicing';
  return 'Device reliability'; // age, and anything unrecognised
}

/* ---------- last bugcheck -> suggested remediation ----------
   Power-state and page-fault stop codes often clear with a firmware or
   driver pass. Codes are compared numerically, so '0x9F', '9f' and
   '0x0000009F' are the same code and '0x19F' is not. */
const FIRMWARE_FIRST_CODES = new Set([0x9f, 0xa0, 0x50]);

export function bugcheckValue(code: string | null | undefined): number | null {
  const s = String(code ?? '').trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]+$/.test(s)) return null;
  return parseInt(s, 16);
}

export function suggestRemediation(bugcheck: string | null | undefined): string {
  const v = bugcheckValue(bugcheck);
  if (v != null && FIRMWARE_FIRST_CODES.has(v)) return 'Firmware update';
  return 'Remote action';
}

/* A queue row's `reason` is an OBJECT (the queue band: FAILING / HIDDEN
   RISK / CRITICAL / …); the CRS `driver` string is what describes the
   dimension. Passing the reason object through would stringify to
   "[object Object]" and silently collapse every device to the fallback. */
export function proactiveReasonKey(r: Partial<QueueRow> | null | undefined): string {
  return String((r && r.driver) || '').trim().toLowerCase();
}

export function proactiveAdditionalInfo(r: Partial<QueueRow>, cfg: Cfg): string {
  const bits = [
    `Model ${r.model || '—'}`,
    `DEX ${r.dex == null ? '—' : fmt(r.dex)}`,
    `CRS driver ${r.driver || '—'}`,
  ];
  if (r.hri != null) bits.push(`HRI ${fmt(r.hri)} (${r.sev || '—'})`);
  if (r.bugcheck) bits.push(`last bugcheck ${r.bugcheck}`);
  if ((r.weeks as number) > 1) bits.push(`${r.weeks} consecutive weeks in queue`);
  if (isExcluded(r.user, cfg))
    bits.push('owner is an admin/service/shared account — verify true owner before submitting');
  return bits.join(' · ');
}

export function tierImpactUrgency(
  tier: string | undefined,
  sev: string | undefined,
): { impact: string; urgency: string } {
  if (tier === 'CRITICAL' || sev === 'FAILING') return { impact: 'High', urgency: 'High' };
  if (tier === 'HIGH' || sev === 'DEGRADING') return { impact: 'Medium', urgency: 'High' };
  if (tier === 'ELEVATED') return { impact: 'Medium', urgency: 'Medium' };
  return { impact: 'Low', urgency: 'Medium' };
}

/** Asset tag = the device name without its alphabetic prefix segments
    (DEMO-LT-0042 -> 0042, L-100147 -> 100147). */
export function affectedAsset(name: string | null | undefined): string {
  return String(name || '').replace(/^(?:[A-Z]+-)+(?=.)/i, '');
}

export function evidenceLine(r: Partial<QueueRow>): string {
  const bits: string[] = [];
  if (r.sev === 'FAILING' || r.sev === 'DEGRADING')
    bits.push(`hardware reliability ${r.sev.toLowerCase()} (HRI ${fmt(r.hri)})`);
  if (r.hidden)
    bits.push('hidden hardware risk — degrading beneath a healthy experience score');
  if (r.tier === 'CRITICAL' || r.tier === 'HIGH')
    bits.push(`composite ${r.tier} (CRS ${fmt(r.crs)}, driver ${r.driver})`);
  if (r.bugcheck) bits.push(`last bugcheck ${r.bugcheck}`);
  if (!bits.length) bits.push(`flagged for proactive review (CRS ${fmt(r.crs)})`);
  return `Proactive: ${bits.join('; ')}.`;
}

/* ---------- Incident (generic ticketing system) ---------- */
export interface IncidentPayload {
  format: 'Incident';
  ownerId: string;
  company: string;
  summary: string;
  description: string;
  incidentType: string;
  affectedAsset: string;
  impact: string;
  urgency: string;
  status: string;
  ownerVerify: boolean;
  [k: string]: unknown;
}

export function incidentTicket(r: Partial<QueueRow>, cfg: Cfg): IncidentPayload {
  const iu = tierImpactUrgency(r.tier, r.sev);
  return {
    format: 'Incident',
    ownerId: r.user || '',
    company: DEMO_COMPANY,
    summary: `Proactive device health — ${r.name} (${r.reason?.label})`,
    description: evidenceLine(r),
    incidentType: 'Proactive',
    affectedAsset: affectedAsset(r.name),
    impact: iu.impact,
    urgency: iu.urgency,
    status: '',
    ownerVerify: isExcluded(r.user, cfg),
  };
}

/* ---------- Proactive Ticket ---------- */
export interface ProactiveTicket {
  format: 'ProactiveTicket';
  ownerId: string;
  ownerName: string;
  identifiedDate: string;
  deviceName: string;
  product: string;
  category: string;
  remediation: string;
  summary: string;
  deliveryMode: string;
  impact: string;
  urgency: string;
  assetTag: string;
  additionalInfo: string;
  ownerVerify: boolean;
  [k: string]: unknown;
}

/* The 13 fields in form order, plus `format` and `ownerVerify`, which
   ticketsCSV() handles separately (ownerVerify becomes its own column). */
export function proactiveTicket(r: Partial<QueueRow>, cfg: Cfg, store: StoreApi): ProactiveTicket {
  const map = mapModelToProduct(r.model);
  const iu = tierImpactUrgency(r.tier, r.sev);
  return {
    format: 'ProactiveTicket',
    ownerId: r.user || '',
    ownerName: '' /* owner ID only in the export — never invented */,
    identifiedDate: store.currentRun()?.weekEnding || new Date().toISOString().slice(0, 10),
    deviceName: r.name as string,
    product: map.product,
    category: suggestCategory(proactiveReasonKey(r)),
    remediation: suggestRemediation(r.bugcheck),
    summary: evidenceLine(r),
    deliveryMode: PROACTIVE_DELIVERY_DEFAULT,
    impact: iu.impact,
    urgency: iu.urgency,
    assetTag: affectedAsset(r.name),
    additionalInfo: proactiveAdditionalInfo(r, cfg),
    ownerVerify: isExcluded(r.user, cfg),
  };
}

/* Why the category was picked — for the form's hint line. Not part of the payload. */
export function proactiveProductWhy(r: Partial<QueueRow> | null | undefined): string {
  return mapModelToProduct(r && r.model).why;
}

/* Required fields still empty, by form label. */
export function proactiveMissing(p: Record<string, unknown>): string[] {
  return PROACTIVE_FIELDS.filter(
    (f) => f.required && !String(p[f.key] == null ? '' : p[f.key]).trim(),
  ).map((f) => f.label);
}

/* Copy-ready payload text, in form order and with the form's own labels. */
export function proactiveTicketText(p: Record<string, unknown>): string {
  let s = PROACTIVE_FIELDS.map(
    (f) => `${f.label.padEnd(24)}: ${p[f.key] === '' || p[f.key] == null ? '—' : p[f.key]}`,
  ).join('\n');
  if (p.ownerVerify)
    s +=
      '\n\n⚠️ Owner is an admin / service / shared account — verify the true owner before submitting.';
  const miss = proactiveMissing(p);
  s += miss.length ? '\n\n⚠️ Missing required: ' + miss.join(', ') : '\n\n✓ All required fields present.';
  s += '\n\nDraft only — Sentinel never submits. Enter it in your ticketing system yourself.';
  return s;
}

export function buildTickets(
  rows: Partial<QueueRow>[],
  format: 'proactive' | 'incident',
  cfg: Cfg,
  store: StoreApi,
): (ProactiveTicket | IncidentPayload)[] {
  return rows.map((r) =>
    format === 'proactive' ? proactiveTicket(r, cfg, store) : incidentTicket(r, cfg),
  );
}

export function ticketsCSV(payloads: Record<string, unknown>[]): string {
  if (!payloads.length) return '';
  const cols = Object.keys(payloads[0]).filter((k) => k !== 'format' && k !== 'ownerVerify');
  const q = (v: unknown): string => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  /* Proactive Ticket exports carry the form's own column headings so a row
     can be read straight against the form; incidents keep their payload keys. */
  const head = cols
    .map((c) => (payloads[0].format === 'ProactiveTicket' ? PROACTIVE_LABELS[c] || c : c))
    .concat(['owner_verify'])
    .map(q)
    .join(',');
  const body = payloads
    .map((p) =>
      cols
        .map((c) => q(p[c]))
        .concat(q(p.ownerVerify ? 'VERIFY' : ''))
        .join(','),
    )
    .join('\n');
  return head + '\n' + body;
}

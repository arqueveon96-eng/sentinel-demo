#!/usr/bin/env node
/* ============================================================
   make-sample-fleet.mjs — writes demo/sample-fleet.csv.

   A SYNTHETIC 300-device fleet in the exact column format the console
   ingests (see SCHEMA_MAP in src/core/ingest.ts): baseline columns plus
   the raw hard-reset / system-crash counts HRI is built on, in one file.

   Deterministic: a seeded PRNG (mulberry32, fixed seed) drives every
   value, so re-running this script reproduces the committed file byte
   for byte and the test suite never chases a moving fixture.

   Every name, user and model is invented. The distribution is mostly a
   healthy fleet, with a handful of planted cases so the demo has
   something to find:
     • composite CRITICAL / HIGH devices (old, slow, crash-heavy)
     • HRI FAILING devices whose experience score still looks healthy
       ("hidden risk" — the case the whole tool exists for)
     • a model cluster sharing one stop code (a platform problem)
     • unattended appliances with no DEX score at all, where raw
       counts are the only signal that reaches them
     • service / shared accounts that must be excluded however bad
       the device looks

   Usage:  node scripts/make-sample-fleet.mjs
   ============================================================ */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED = 20260807;
const N = 300;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'sample-fleet.csv');

/* ---------- deterministic randomness ---------- */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.round(between(a, b));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const chance = (p) => rand() < p;

/* ---------- vocabulary (all invented) ---------- */
const GB = 1024 ** 3;
const TYPES = [
  // prefix, model, share of fleet, memory options (GB)
  { prefix: 'LT', model: 'Laptop L1', share: 0.4, mem: [8, 16, 16, 32] },
  { prefix: 'LT', model: 'Laptop L2', share: 0.18, mem: [16, 16, 32] },
  { prefix: 'DT', model: 'Desktop D1', share: 0.14, mem: [8, 16, 16] },
  { prefix: 'WS', model: 'Workstation W1', share: 0.06, mem: [32, 64] },
  { prefix: 'RT', model: 'Rugged Tablet R1', share: 0.08, mem: [8, 16] },
  { prefix: 'RL', model: 'Rugged Laptop R2', share: 0.08, mem: [16, 16, 32] },
  { prefix: 'VA', model: 'Video Appliance V1', share: 0.06, mem: [16] },
];
const OSES = [
  ['Windows 11 Enterprise 24H2', 0.5],
  ['Windows 11 Enterprise 23H2', 0.24],
  ['Windows 11 Enterprise 22H2', 0.12],
  ['Windows 11 Enterprise 25H2', 0.06],
  ['Windows 10 Enterprise 22H2', 0.08],
];
const BUGCHECKS = {
  '0x124': 'WHEA_UNCORRECTABLE_ERROR',
  '0x9F': 'DRIVER_POWER_STATE_FAILURE',
  '0x1A': 'MEMORY_MANAGEMENT',
  '0x50': 'PAGE_FAULT_IN_NONPAGED_AREA',
  '0x7A': 'KERNEL_DATA_INPAGE_ERROR',
  '0xD1': 'DRIVER_IRQL_NOT_LESS_OR_EQUAL',
  '0xEF': 'CRITICAL_PROCESS_DIED',
};
const SHARED_OWNERS = ['svc-backup01', 'svc-imaging', 'shared-frontdesk', 'kiosk-lobby', 'helpdesk-admin'];

const HEADER = [
  'device.name',
  'device.login.last_login_user_name',
  'device.hardware.model',
  'device.operating_system.name',
  'device.days_since_first_seen',
  'device.days_since_last_seen',
  'device.boot.days_since_last_full_boot',
  'device.hardware.memory',
  'dex_score_',
  'number_of_crashes_',
  'system_drive_free_space_gb_',
  'total_hard_resets_',
  'last_hard_reset_time_',
  'total_system_crashes_',
  'last_bugcheck_code_',
  'last_bugcheck_label_',
];

function weighted(pairs) {
  let r = rand();
  for (const [v, w] of pairs) {
    if ((r -= w) < 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

function resetTime() {
  const day = String(int(3, 28)).padStart(2, '0');
  const hour = String(int(6, 20)).padStart(2, '0');
  return `2026-08-${day}T${hour}:00:00Z`;
}

/* ---------- the fleet: assign a type to every slot, in order ---------- */
const slots = [];
for (const t of TYPES) for (let k = 0; k < Math.round(t.share * N); k++) slots.push(t);
while (slots.length < N) slots.push(TYPES[0]);
slots.length = N;
// a stable shuffle so device types are interleaved across the numbering
for (let i = slots.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [slots[i], slots[j]] = [slots[j], slots[i]];
}

/* ---------- a healthy baseline device ---------- */
function baseline(i, type) {
  const unattended = type.prefix === 'VA';
  const hr = chance(0.015) ? 1 : 0;
  const sc = chance(0.015) ? 1 : 0;
  const bug = sc > 0 ? pick(Object.keys(BUGCHECKS)) : '';
  return {
    name: `DEMO-${type.prefix}-${String(i + 1).padStart(4, '0')}`,
    user: unattended ? '' : `user${String(i + 1).padStart(4, '0')}`,
    model: type.model,
    os: weighted(OSES),
    age: int(30, 1500),
    seen: chance(0.95) ? int(0, 3) : int(4, 10),
    boot: chance(0.9) ? int(0, 14) : int(15, 45),
    memGB: pick(type.mem),
    // DEX-ineligible: appliances never get an experience score
    dex: unattended || chance(0.04) ? null : int(72, 99),
    crashes: chance(0.9) ? int(0, 3) : chance(0.7) ? int(4, 25) : int(30, 120),
    free: chance(0.93) ? int(60, 400) : chance(0.7) ? int(20, 59) : int(8, 19),
    hardResets: hr,
    sysCrashes: sc,
    bugcheck: bug,
  };
}

const fleet = slots.map((t, i) => baseline(i, t));
const byModel = (m) => fleet.filter((d) => d.model === m);
const notVA = fleet.filter((d) => !d.model.startsWith('Video'));

/* ---------- planted cases (deterministic: chosen by position) ---------- */
// 1. composite CRITICAL: old, slow, crash-heavy, low on RAM and disk
[3, 41, 97, 156, 233].forEach((k, n) => {
  Object.assign(notVA[k], {
    dex: int(15, 30),
    crashes: n === 0 ? 6887 : int(140, 700), // one runaway: the >=500 anti-saturation case
    age: int(1150, 1500),
    memGB: 8,
    free: int(8, 18),
    os: 'Windows 10 Enterprise 22H2',
    seen: int(8, 12),
  });
});
// 2. composite HIGH: degraded experience and a steady crash load
[12, 58, 77, 120, 171, 204, 249, 268].forEach((k) => {
  Object.assign(notVA[k], {
    dex: int(48, 66),
    crashes: int(22, 45),
    age: int(760, 1050),
    memGB: 16,
    free: int(55, 90),
    os: 'Windows 11 Enterprise 22H2',
    seen: int(2, 3),
  });
});
// 3. HRI FAILING beneath a healthy experience score (hidden risk)
[[25, 3, 2, '0x124'], [88, 6, 1, '0x7A'], [140, 10, 3, '0x1A'], [190, 4, 2, '0x50']].forEach(
  ([k, hr, sc, bug]) => {
    Object.assign(notVA[k], { dex: int(84, 95), hardResets: hr, sysCrashes: sc, bugcheck: bug });
  },
);
// 4. DEGRADING / WATCH beneath a healthy score
[[33, 2, 0, ''], [66, 0, 1, '0xD1'], [109, 2, 1, '0xEF'], [182, 1, 0, ''], [222, 0, 2, '0x124'], [259, 2, 0, '']].forEach(
  ([k, hr, sc, bug]) => {
    Object.assign(notVA[k], { dex: int(80, 96), hardResets: hr, sysCrashes: sc, bugcheck: bug });
  },
);
// 5. a model cluster: one rugged-tablet model sharing a power-state stop code
byModel('Rugged Tablet R1')
  .filter((_, n) => n % 3 === 0)
  .forEach((d) => Object.assign(d, { hardResets: int(1, 3), sysCrashes: int(1, 2), bugcheck: '0x9F' }));
// 6. unattended appliances: no DEX at all, so raw counts are the only signal
byModel('Video Appliance V1')
  .slice(0, 2)
  .forEach((d, n) => Object.assign(d, { hardResets: n === 0 ? 4 : 2, sysCrashes: n === 0 ? 1 : 0, bugcheck: n === 0 ? '0x124' : '' }));
// 7. service / shared accounts — excluded from dispatch however bad the device is
[7, 52, 131, 177, 241].forEach((k, n) => {
  notVA[k].user = SHARED_OWNERS[n];
});
Object.assign(notVA[7], { dex: 12, crashes: 900, hardResets: 8, sysCrashes: 3, bugcheck: '0x124', free: 6 });

/* ---------- serialise ---------- */
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const rows = fleet.map((d) => [
  d.name,
  d.user,
  d.model,
  d.os,
  d.age,
  d.seen,
  d.boot,
  d.memGB * GB,
  d.dex == null ? '' : d.dex,
  d.crashes,
  d.free,
  d.hardResets,
  d.hardResets > 0 ? resetTime() : '',
  d.sysCrashes,
  d.sysCrashes > 0 ? d.bugcheck : '',
  d.sysCrashes > 0 ? BUGCHECKS[d.bugcheck] : '',
]);

const csv = [HEADER, ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, csv);
console.log(`wrote ${OUT} (${rows.length} devices, seed ${SEED})`);

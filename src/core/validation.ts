/* ============================================================
   validation.ts — port of js/validation.js. Outcome ledger +
   accuracy + tuning proposals.
   HRI stays PROVISIONAL until 20+ graded outcomes. One tuning
   change per 60 days. Tuning is proposed, never auto-applied.

   PORT NOTE: `CFG` and `Store` become explicit parameters.
   ============================================================ */

import type { Cfg, StoreApi } from './types';

export const VALIDATION_MIN = 20;

export interface ValidationMetrics {
  total: number;
  graded: number;
  pending: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  avgLead: number | null;
  credible: boolean;
}

export function validationMetrics(store: StoreApi): ValidationMetrics {
  const led = store.getOutcomes();
  const graded = led.filter((o) => o.outcome !== 'pending');
  const n = graded.length;
  const flagged = graded.filter(
    (o) => o.predictedSev === 'FAILING' || o.predictedSev === 'DEGRADING',
  );
  const tp = flagged.filter((o) => o.outcome === 'confirmed_fail').length;
  const fp = flagged.filter((o) => o.outcome === 'no_fail').length;
  const fn = graded.filter(
    (o) =>
      o.outcome === 'confirmed_fail' &&
      o.predictedSev !== 'FAILING' &&
      o.predictedSev !== 'DEGRADING',
  ).length;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const leads = graded.filter((o) => o.leadDays != null).map((o) => o.leadDays as number);
  const avgLead = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null;
  return {
    total: led.length,
    graded: n,
    pending: led.length - n,
    tp,
    fp,
    fn,
    precision: precision == null ? null : +(100 * precision).toFixed(0),
    recall: recall == null ? null : +(100 * recall).toFixed(0),
    avgLead: avgLead == null ? null : +avgLead.toFixed(1),
    credible: n >= VALIDATION_MIN,
  };
}

export interface TuningProposal {
  status: 'insufficient' | 'stable' | 'propose';
  msg?: string;
  props?: { change: string; why: string }[];
  metrics?: ValidationMetrics;
  guard?: { allowed: boolean; daysLeft: number };
}

export function tuningProposal(cfg: Cfg, store: StoreApi): TuningProposal {
  const m = validationMetrics(store);
  const guard = store.tuningAllowed();
  if (!m.credible)
    return {
      status: 'insufficient',
      msg: `${m.graded}/${VALIDATION_MIN} graded outcomes. HRI bands stay provisional until ${VALIDATION_MIN} are recorded.`,
    };
  const props: { change: string; why: string }[] = [];
  if (m.precision != null && m.precision < 60 && m.fp >= 3)
    props.push({
      change: `Raise HRI WATCH ${cfg.hriBand.WATCH} → ${cfg.hriBand.WATCH + 2}`,
      why: `Precision ${m.precision}% with ${m.fp} false positives — the WATCH edge is too loose.`,
    });
  if (m.recall != null && m.recall < 70 && m.fn >= 2)
    props.push({
      change: `Lower HRI FAILING ${cfg.hriBand.FAILING} → ${cfg.hriBand.FAILING - 4}`,
      why: `Recall ${m.recall}% with ${m.fn} missed failure(s) — FAILING is set too high.`,
    });
  if (!props.length)
    return {
      status: 'stable',
      msg: `Precision ${m.precision ?? '—'}% · recall ${m.recall ?? '—'}% — bands look calibrated. No change proposed.`,
      metrics: m,
    };
  return { status: 'propose', props, metrics: m, guard };
}

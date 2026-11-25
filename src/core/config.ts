/* ============================================================
   config.ts — port of js/config.js. Editable, persistent CFG.
   Applied at boot. Invalid config refused, not saved.

   PORT NOTE: the legacy functions mutated the `CFG` global in place and the
   regression suite asserts on that live object (`CFG.crsTier.CRITICAL===40`
   right after saveConfig). That mutation semantic is preserved: these
   functions take the Cfg object and mutate it. `Store` is an explicit param.
   ============================================================ */

import type { Cfg, ConfigInput, StoreApi } from './types';

export const CFG_DEFAULTS: ConfigInput = {
  crsW: { dex: 20, crash: 20, age: 15, ram: 10, storage: 15, os: 10, avail: 10 },
  crsTier: { CRITICAL: 52, HIGH: 38, ELEVATED: 25, MONITOR: 12 },
  hriBand: { FAILING: 40, DEGRADING: 20, WATCH: 8 },
  excludeSrc: ['^svc', 'admin$', '^shared-', '^kiosk-', 'service account'],
};

export function applyStoredConfig(cfg: Cfg, store: StoreApi): void {
  const c = store.getConfig();
  if (!c) return;
  if (c.crsW) cfg.crsW = { ...CFG_DEFAULTS.crsW, ...c.crsW };
  if (c.crsTier) cfg.crsTier = { ...CFG_DEFAULTS.crsTier, ...c.crsTier };
  if (c.hriBand) cfg.hriBand = { ...CFG_DEFAULTS.hriBand, ...c.hriBand };
  if (c.excludeSrc) cfg.excludePatterns = c.excludeSrc.map((s) => new RegExp(s, 'i'));
}

export function currentConfig(cfg: Cfg, store: StoreApi): ConfigInput {
  return {
    crsW: { ...cfg.crsW },
    crsTier: { ...cfg.crsTier },
    hriBand: { ...cfg.hriBand },
    excludeSrc: store.getConfig()?.excludeSrc || CFG_DEFAULTS.excludeSrc.slice(),
  };
}

export function validateConfig(cfg: ConfigInput): { ok: boolean; errors: string[] } {
  const e: string[] = [];
  const wSum = Object.values(cfg.crsW).reduce((a, b) => a + (+b || 0), 0);
  if (wSum !== 100) e.push(`CRS weights must sum to 100 (currently ${wSum}).`);
  Object.entries(cfg.crsW).forEach(([k, v]) => {
    if (+v < 0) e.push(`Weight ${k} cannot be negative.`);
  });
  const t = cfg.crsTier;
  if (!(t.CRITICAL > t.HIGH && t.HIGH > t.ELEVATED && t.ELEVATED > t.MONITOR && t.MONITOR >= 0))
    e.push('CRS tiers must be strictly descending: CRITICAL > HIGH > ELEVATED > MONITOR ≥ 0.');
  const h = cfg.hriBand;
  if (!(h.FAILING > h.DEGRADING && h.DEGRADING > h.WATCH && h.WATCH > 0))
    e.push('HRI bands must be strictly descending: FAILING > DEGRADING > WATCH > 0.');
  try {
    (cfg.excludeSrc || []).forEach((s) => new RegExp(s));
  } catch {
    e.push('An owner-exclude pattern is not a valid expression.');
  }
  return { ok: e.length === 0, errors: e };
}

export function saveConfig(
  input: ConfigInput,
  cfg: Cfg,
  store: StoreApi,
): { ok: boolean; errors: string[] } {
  const v = validateConfig(input);
  if (!v.ok) return v;
  store.setConfig({
    crsW: { ...input.crsW },
    crsTier: { ...input.crsTier },
    hriBand: { ...input.hriBand },
    excludeSrc: input.excludeSrc.slice(),
  });
  applyStoredConfig(cfg, store);
  return { ok: true, errors: [] };
}

export function resetConfigDefaults(cfg: Cfg, store: StoreApi): void {
  store.resetConfig();
  cfg.crsW = { ...CFG_DEFAULTS.crsW };
  cfg.crsTier = { ...CFG_DEFAULTS.crsTier };
  cfg.hriBand = { ...CFG_DEFAULTS.hriBand };
  cfg.excludePatterns = CFG_DEFAULTS.excludeSrc.map((s) => new RegExp(s, 'i'));
}

/* ============================================================
   ConfigRoute.tsx — the thresholds, editable.

   This is not a settings drawer. Moving a tier edge changes what the
   console calls CRITICAL, and moving an HRI band changes what it calls
   FAILING — so the screen is deliberate: it validates through the
   core's own `validateConfig`, shows the core's own error strings next
   to the field each one is about, and says out loud that nothing
   already committed is rescored.

   The committed run is NOT recomputed when you save. The baseline is
   frozen; a new configuration applies to the next scoring pass. That
   is the "baseline never silently overwritten" guardrail, and it is
   why this screen says so rather than quietly re-rendering the queue.
   ============================================================ */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RotateCcw, TriangleAlert, X } from 'lucide-react';
import type { ConfigInput, CrsWeights, CrsTiers, HriBands } from '@/core/types';
import {
  CFG_DEFAULTS,
  currentConfig,
  resetConfigDefaults,
  saveConfig,
  validateConfig,
} from '@/core/config';
import { cfg, sentinel, useSentinelStore } from '@/store/sentinel.store';
import { useRev, useRun } from '@/app/lib/derived';
import { LiveRegion, useAnnouncer } from '@/app/components/bits';

const WEIGHTS: [keyof CrsWeights, string][] = [
  ['dex', 'DEX'],
  ['crash', 'Crashes'],
  ['age', 'Age'],
  ['ram', 'RAM'],
  ['storage', 'Storage'],
  ['os', 'OS'],
  ['avail', 'Availability'],
];
const TIERS: [keyof CrsTiers, string][] = [
  ['CRITICAL', 'CRITICAL'],
  ['HIGH', 'HIGH'],
  ['ELEVATED', 'ELEVATED'],
  ['MONITOR', 'MONITOR'],
];
const BANDS: [keyof HriBands, string][] = [
  ['FAILING', 'FAILING'],
  ['DEGRADING', 'DEGRADING'],
  ['WATCH', 'WATCH'],
];

/** The core's error strings, routed to the field group each is about. */
function scopeOf(err: string): 'weights' | 'tiers' | 'bands' | 'patterns' | 'other' {
  if (/^CRS weights/.test(err) || /^Weight /.test(err)) return 'weights';
  if (/^CRS tiers/.test(err)) return 'tiers';
  if (/^HRI bands/.test(err)) return 'bands';
  if (/owner-exclude/.test(err)) return 'patterns';
  return 'other';
}
/** `Weight age cannot be negative.` -> `age`, so it lands on that input. */
function weightKeyOf(err: string): string | null {
  const m = /^Weight (\w+) cannot be negative\.$/.exec(err);
  return m ? m[1] : null;
}

type Draft = { crsW: Record<string, string>; crsTier: Record<string, string>; hriBand: Record<string, string>; excludeSrc: string[] };

function toDraft(c: ConfigInput): Draft {
  return {
    crsW: Object.fromEntries(Object.entries(c.crsW).map(([k, v]) => [k, String(v)])),
    crsTier: Object.fromEntries(Object.entries(c.crsTier).map(([k, v]) => [k, String(v)])),
    hriBand: Object.fromEntries(Object.entries(c.hriBand).map(([k, v]) => [k, String(v)])),
    excludeSrc: c.excludeSrc.slice(),
  };
}
const n = (v: string): number => (v.trim() === '' ? NaN : Number(v));
function toInput(d: Draft): ConfigInput {
  const num = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number.isFinite(n(v)) ? n(v) : 0]));
  return {
    crsW: num(d.crsW) as unknown as CrsWeights,
    crsTier: num(d.crsTier) as unknown as CrsTiers,
    hriBand: num(d.hriBand) as unknown as HriBands,
    excludeSrc: d.excludeSrc.filter((s) => s.trim() !== ''),
  };
}

export function ConfigRoute() {
  const rev = useRev();
  const run = useRun();
  const touch = useSentinelStore((s) => s.touch);
  const stored = useMemo(() => currentConfig(cfg, sentinel), [rev]);
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored));
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [msg, say] = useAnnouncer();

  const input = toInput(draft);
  const check = validateConfig(input);
  const errors = check.errors;
  const errFor = (scope: ReturnType<typeof scopeOf>) => errors.filter((e) => scopeOf(e) === scope);
  const weightSum = Object.values(input.crsW).reduce((a, b) => a + (+b || 0), 0);
  const dirty = JSON.stringify(input) !== JSON.stringify(stored);

  function set(group: 'crsW' | 'crsTier' | 'hriBand', key: string, value: string) {
    setSaved(false);
    setDraft((d) => ({ ...d, [group]: { ...d[group], [key]: value } }));
  }

  function save() {
    const res = saveConfig(input, cfg, sentinel);
    if (!res.ok) {
      say('Not saved — fix the errors shown beside the fields.');
      return;
    }
    setSaved(true);
    setDraft(toDraft(currentConfig(cfg, sentinel)));
    touch();
    say('Configuration saved. It applies on the next scoring pass.');
  }

  function reset() {
    resetConfigDefaults(cfg, sentinel);
    setDraft(toDraft(currentConfig(cfg, sentinel)));
    setConfirmReset(false);
    setSaved(true);
    touch();
    say('Configuration reset to the shipped defaults.');
  }

  return (
    <div className="stage-page">
      <div className="lens" style={{ maxWidth: 940 }}>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Config</h1>
          <p>
            Weights, tier edges, HRI bands and the owner-exclusion patterns. Validated by the
            scoring core, not by this screen.
          </p>
        </div>

        <p className="guard-line">
          Nothing already committed is rescored. The baseline for{' '}
          <span className="mono">{run ? run.weekEnding : 'the next run'}</span> stays exactly as it
          was frozen —{' '}
          <b style={{ color: 'var(--txt)' }}>results change on the next scoring pass</b>, when you
          commit the following week&apos;s export.
        </p>

        {/* ---------- weights ---------- */}
        <section className="card" aria-label="CRS weights">
          <div className="card-head">
            <h2 className="card-title">CRS weights</h2>
            <span className="mono card-sub">must sum to 100</span>
            <span
              className="mono sum"
              style={{ marginLeft: 'auto', color: weightSum === 100 ? 'var(--green)' : 'var(--red)' }}
            >
              sum {weightSum} / 100
            </span>
          </div>
          <div className="cfg-grid">
            {WEIGHTS.map(([k, label]) => {
              const fieldErr = errors.find((e) => weightKeyOf(e) === k);
              return (
                <NumField
                  key={k}
                  id={`w-${k}`}
                  label={label}
                  value={draft.crsW[k] ?? ''}
                  onChange={(v) => set('crsW', k, v)}
                  invalid={!!fieldErr}
                  error={fieldErr}
                  hint={`default ${CFG_DEFAULTS.crsW[k]}`}
                />
              );
            })}
          </div>
          <Errors list={errFor('weights').filter((e) => !weightKeyOf(e))} />
          <p className="card-note">
            <span className="mono">
              CRS = (dex×{input.crsW.dex} + crash×{input.crsW.crash} + age×{input.crsW.age} + ram×
              {input.crsW.ram} + storage×{input.crsW.storage} + os×{input.crsW.os} + avail×
              {input.crsW.avail}) / 100
            </span>
          </p>
        </section>

        <div className="lens-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {/* ---------- tiers ---------- */}
          <section className="card" aria-label="CRS tier edges">
            <div className="card-head">
              <h2 className="card-title">CRS tier edges</h2>
              <span className="mono card-sub">strictly descending</span>
            </div>
            <div className="cfg-grid">
              {TIERS.map(([k, label]) => (
                <NumField
                  key={k}
                  id={`t-${k}`}
                  label={label}
                  value={draft.crsTier[k] ?? ''}
                  onChange={(v) => set('crsTier', k, v)}
                  invalid={errFor('tiers').length > 0}
                  hint={`default ${CFG_DEFAULTS.crsTier[k]}`}
                />
              ))}
            </div>
            <Errors list={errFor('tiers')} />
            <p className="card-note">
              A device scores CRITICAL at or above {input.crsTier.CRITICAL}, HIGH at{' '}
              {input.crsTier.HIGH}, ELEVATED at {input.crsTier.ELEVATED}, MONITOR at{' '}
              {input.crsTier.MONITOR}, and HEALTHY below it. Max attainable CRS on the current
              weights is about 76 — an edge above that is unreachable.
            </p>
          </section>

          {/* ---------- HRI bands ---------- */}
          <section className="card" aria-label="HRI bands">
            <div className="card-head">
              <h2 className="card-title">HRI bands</h2>
              <span className="mono card-sub">strictly descending · provisional</span>
            </div>
            <div className="cfg-grid">
              {BANDS.map(([k, label]) => (
                <NumField
                  key={k}
                  id={`h-${k}`}
                  label={label}
                  value={draft.hriBand[k] ?? ''}
                  onChange={(v) => set('hriBand', k, v)}
                  invalid={errFor('bands').length > 0}
                  hint={`default ${CFG_DEFAULTS.hriBand[k]}`}
                />
              ))}
            </div>
            <Errors list={errFor('bands')} />
            <p className="card-note">
              These are the bands the validation ledger is meant to tune, one change per 60-day
              cycle, once twenty outcomes are graded. Until then they are provisional —{' '}
              <Link to="/trends" style={{ color: 'var(--teal-l)' }}>
                Trends
              </Link>{' '}
              shows how close the ledger is.
            </p>
          </section>
        </div>

        {/* ---------- exclusions ---------- */}
        <section className="card" aria-label="Owner-exclusion patterns">
          <div className="card-head">
            <h2 className="card-title">Owner-exclusion patterns</h2>
            <span className="mono card-sub">
              case-insensitive regular expressions, matched against the owner
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {draft.excludeSrc.map((p, i) => {
              let bad: string | null = null;
              try {
                new RegExp(p);
              } catch (e) {
                bad = e instanceof Error ? e.message : 'not a valid expression';
              }
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div className="pattern-row">
                    <label className="sr-only" htmlFor={`pat-${i}`}>
                      Exclusion pattern {i + 1}
                    </label>
                    <input
                      id={`pat-${i}`}
                      className="mono input"
                      value={p}
                      aria-invalid={!!bad}
                      spellCheck={false}
                      onChange={(e) => {
                        setSaved(false);
                        setDraft((d) => {
                          const next = d.excludeSrc.slice();
                          next[i] = e.target.value;
                          return { ...d, excludeSrc: next };
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      aria-label={`Remove pattern ${p || i + 1}`}
                      onClick={() => {
                        setSaved(false);
                        setDraft((d) => ({
                          ...d,
                          excludeSrc: d.excludeSrc.filter((_, j) => j !== i),
                        }));
                      }}
                    >
                      <X size={12} aria-hidden />
                      Remove
                    </button>
                  </div>
                  {bad ? (
                    <p className="err" role="alert">
                      <TriangleAlert size={12} aria-hidden style={{ flex: 'none', marginTop: 1 }} />
                      {bad}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <Errors list={errFor('patterns')} />
          <button
            type="button"
            className="btn btn-sm"
            style={{ width: 'fit-content' }}
            onClick={() => {
              setSaved(false);
              setDraft((d) => ({ ...d, excludeSrc: [...d.excludeSrc, ''] }));
            }}
          >
            <Plus size={12} aria-hidden />
            Add a pattern
          </button>
          <p className="card-note">
            An excluded device is still ingested and still counted in the export total — it is left
            out of every scored metric and never reaches the queue. Fleet lists which accounts these
            patterns actually caught this week.
          </p>
        </section>

        {/* ---------- save ---------- */}
        <section className="card" aria-label="Save configuration">
          <Errors list={errFor('other')} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!check.ok || !dirty}
              onClick={save}
            >
              Save configuration
            </button>
            {confirmReset ? (
              <>
                <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                  Reset every value above to the shipped defaults?
                </span>
                <button type="button" className="btn btn-sm" onClick={reset}>
                  Yes, reset
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmReset(true)}>
                <RotateCcw size={12} aria-hidden />
                Reset to defaults
              </button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11.5 }}>
              {!check.ok ? (
                <span style={{ color: 'var(--red)' }}>
                  {errors.length} problem{errors.length === 1 ? '' : 's'} — nothing is saved while
                  the core refuses it
                </span>
              ) : saved && !dirty ? (
                <span className="ok-line">
                  Saved. It applies on the next scoring pass.
                </span>
              ) : dirty ? (
                <span style={{ color: 'var(--amber)' }}>Unsaved changes</span>
              ) : (
                <span style={{ color: 'var(--dim)' }}>Matches what is stored</span>
              )}
            </span>
          </div>
        </section>
      </div>
      <LiveRegion message={msg} />
    </div>
  );
}

/* ---------- pieces ---------- */

function NumField({
  id,
  label,
  value,
  onChange,
  invalid,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="mono input cfg-num"
        inputMode="numeric"
        value={value}
        aria-invalid={!!invalid}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
        style={invalid ? { borderColor: 'var(--red)' } : undefined}
      />
      {error ? (
        <p className="err" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** The core's own strings, verbatim. This screen never rewords a rejection. */
function Errors({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {list.map((e) => (
        <p className="err" key={e} role="alert">
          <TriangleAlert size={12} aria-hidden style={{ flex: 'none', marginTop: 1 }} />
          {e}
        </p>
      ))}
    </div>
  );
}

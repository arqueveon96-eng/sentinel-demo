/* ============================================================
   ClosePanel.tsx — Stage 5 asks what actually happened.

   The outcome goes to the core's `addOutcome`, which is the only thing
   that moves precision, recall and lead time — and the only thing that
   can ever take the HRI bands off provisional. Band changes stay
   proposals: one per 60-day cycle, never applied here.
   ============================================================ */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { Device, Outcome, QueueRow, Run } from '@/core/types';
import { sentinel } from '@/store/sentinel.store';
import { proved } from '@/core/verdict';
import { Segments } from './Dossier';
import { PanelShell } from './PanelShell';

const CHOICES = [
  { key: 'confirmed_fail', label: 'Confirmed failure', color: 'var(--green)' },
  { key: 'no_fail', label: 'No failure', color: 'var(--amber)' },
  { key: 'false_positive', label: 'False positive', color: 'var(--purple)' },
] as const;

export function ClosePanel({
  row,
  qrow,
  run,
  existing,
  onRecorded,
  onAdvance,
  onRoundup,
  say,
}: {
  row: Device;
  qrow: QueueRow | null;
  run: Run | null;
  existing: Outcome | null;
  onRecorded: () => void;
  onAdvance: () => void;
  /** opens the changelog-derived weekly roundup sheet */
  onRoundup: () => void;
  say: (m: string) => void;
}) {
  const [choice, setChoice] = useState<string>(existing?.outcome ?? '');
  const [lead, setLead] = useState<string>(
    existing?.leadDays == null ? '' : String(existing.leadDays),
  );
  const [note, setNote] = useState(existing?.note ?? '');

  useEffect(() => {
    setChoice(existing?.outcome ?? '');
    setLead(existing?.leadDays == null ? '' : String(existing.leadDays));
    setNote(existing?.note ?? '');
  }, [row.name, existing]);

  // the sentence previews the choice being made, not just the saved one
  const preview: Outcome | null = choice
    ? {
        device: row.name as string,
        week: run?.weekEnding ?? null,
        predictedSev: (row.sev as string) ?? null,
        predictedTier: (row.tier as string) ?? null,
        hri: row.hri ?? null,
        crs: row.crs ?? null,
        outcome: choice,
        component: '',
        leadDays: lead.trim() === '' ? null : Number(lead),
        note,
        ts: existing?.ts ?? new Date().toISOString(),
      }
    : existing;
  const p = proved(row, preview);

  function record() {
    if (!choice) return;
    sentinel.addOutcome({
      device: row.name as string,
      week: run?.weekEnding ?? null,
      predictedSev: (row.sev as string) ?? null,
      predictedTier: (row.tier as string) ?? null,
      hri: row.hri ?? null,
      crs: row.crs ?? null,
      outcome: choice,
      component: String(sentinel.getOverlay(row.name as string).component ?? ''),
      leadDays: lead.trim() === '' ? null : Number(lead),
      note,
    });
    onRecorded();
    say(`Outcome recorded for ${row.name}.`);
    onAdvance();
  }

  const leadInvalid = lead.trim() !== '' && !Number.isFinite(Number(lead));

  return (
    <PanelShell
      stage="STAGE 5 · CLOSE"
      ask="This stage asks for one thing: what actually happened."
      hint="Ground truth. This is what turns HRI from a heuristic into a prediction."
      cols="1.2fr 1fr"
      foot={
        <>
          <span>After outcomes, still in Close:</span>
          <Link className="mono chip" to="/reports">
            FOUR QUESTIONS
          </Link>
          <Link className="mono chip" to="/reports?r=status">
            WEEKLY STATUS
          </Link>
          <Link className="mono chip" to="/reports?r=exec">
            EXEC BRIEF
          </Link>
          <button type="button" className="mono chip" onClick={onRoundup}>
            ROUNDUP
          </button>
          <span>— all derived from the changelog, never from memory.</span>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend style={{ fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: 6 }}>
            Outcome for <span className="mono">{row.name}</span>
          </legend>
          <div className="segment" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {CHOICES.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={choice === c.key}
                onClick={() => setChoice(c.key)}
                style={
                  choice === c.key
                    ? {
                        color: c.color,
                        borderColor: c.color,
                        background: `color-mix(in srgb, ${c.color} 16%, transparent)`,
                      }
                    : undefined
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 8 }}>
          <div className="field">
            <label className="field-label" htmlFor="lead">
              Lead time (days)
            </label>
            <input
              id="lead"
              className="mono input"
              inputMode="numeric"
              value={lead}
              placeholder="—"
              aria-invalid={leadInvalid}
              onChange={(e) => setLead(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="outnote">
              Note
            </label>
            <input
              id="outnote"
              className="mono input"
              value={note}
              placeholder="What happened, and when."
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {leadInvalid ? (
          <p style={{ fontSize: 11.5, color: 'var(--red)', margin: 0 }} role="alert">
            Lead time has to be a number of days, or empty.
          </p>
        ) : null}

        {qrow && qrow.state === 'NEW' ? (
          <p style={{ fontSize: 11.5, color: 'var(--dim)', margin: 0 }}>
            This machine was never worked — recording an outcome for it is still valid, and it
            counts as a miss if it failed.
          </p>
        ) : null}

        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 'auto' }}
          disabled={!choice || leadInvalid}
          onClick={record}
        >
          Record outcome · next machine
          <ArrowRight size={12} aria-hidden />
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 14px',
          borderRadius: 8,
          background: 'var(--panel-3)',
          border: '1px solid var(--line-2)',
          minWidth: 0,
        }}
      >
        <p className="mono eyebrow" style={{ margin: 0 }}>
          WHAT THIS ONE PROVED
        </p>
        <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--body)', margin: 0 }}>
          <Segments segs={p.segs} accent="var(--red)" />
        </p>
        <p
          style={{
            fontSize: 11.5,
            color: 'var(--dim)',
            lineHeight: 1.5,
            borderTop: '1px solid var(--line-2)',
            paddingTop: 8,
            marginTop: 'auto',
            marginBottom: 0,
          }}
        >
          Precision, recall and lead time recompute from every recorded outcome. Band changes are{' '}
          <b style={{ color: 'var(--txt)' }}>proposed</b>, never auto-applied — one per 60-day cycle.
        </p>
      </div>
    </PanelShell>
  );
}

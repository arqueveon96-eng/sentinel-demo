/* ============================================================
   PhasesSheet.tsx — the seven fleet-level investigation phases.

   These questions are about the estate, not about the machine in the
   dossier: "what shape is the fleet in", "which desktops does DEX
   never see". Putting them on a per-device screen was the old
   console's one real information-architecture mistake, so here they
   live in their own sheet, reachable from the Investigate stage.

   Each card carries the question, the KPIs the ported `buildPhases()`
   computed from the committed run, the NQL to paste into Nexthink, how
   to read what comes back, what to write down, and the note field —
   persisted through the core's `savePhaseNote`, which stores it on the
   committed run itself.

   P6 is first and marked READ FIRST: a device with no DEX score is
   invisible to every composite view until you have that list.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { buildPhases } from '@/core/investigate';
import { fleetPhases } from '@/core/phases';
import { cfg, sentinel, useSentinelStore } from '@/store/sentinel.store';
import type { Run } from '@/core/types';
import { CopyButton } from '@/app/components/bits';
import { Sheet } from '@/app/components/Sheet';

export function PhasesSheet({
  run,
  onClose,
  say,
}: {
  run: Run;
  onClose: () => void;
  say: (m: string) => void;
}) {
  const touch = useSentinelStore((s) => s.touch);
  const phases = useMemo(() => fleetPhases(run.weekEnding), [run.weekEnding]);
  const computed = useMemo(() => buildPhases(run, cfg), [run]);
  const [open, setOpen] = useState<string>('P6');

  return (
    <Sheet
      title="Fleet investigation phases"
      subtitle={
        <>
          Seven questions about the estate, in the order to ask them. Your notes are stored on the
          committed run for <span className="mono">{run.weekEnding}</span>.
        </>
      }
      closeLabel="Close the phases sheet"
      onClose={onClose}
      width={760}
    >
      {phases.map((p) => {
        const c = computed.find((x) => x.n === p.n);
        const isOpen = open === p.id;
        return (
          <article key={p.id} className={`phase-card${p.readFirst ? ' is-first' : ''}`}>
            <button
              type="button"
              className="phase-head"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? '' : p.id)}
            >
              <span className="mono phase-n">{p.id}</span>
              {p.readFirst ? <span className="mono readfirst">READ FIRST</span> : null}
              <span className="phase-title">{p.title}</span>
              <span className="phase-q">{p.question}</span>
              <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--dim)' }}>
                {isOpen ? 'hide' : 'open'}
              </span>
            </button>
            {isOpen ? (
              <div className="phase-body">
                {c?.kpis.length ? (
                  <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
                    {c.kpis.map(([label, value]) => (
                      <div className="kpi" key={label}>
                        <span className="mono kpi-value" style={{ fontSize: 18 }}>
                          {String(value)}
                        </span>
                        <span className="kpi-label">{label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div>
                  <p className="mono eyebrow" style={{ margin: '0 0 4px' }}>
                    NQL QUERY · ILLUSTRATIVE
                  </p>
                  <pre className="mono code" style={{ maxHeight: 210 }} aria-label={`${p.id} query`}>
                    {p.query}
                  </pre>
                </div>
                <CopyButton
                  className="btn btn-sm btn-teal"
                  text={p.query}
                  onDone={(ok) => say(ok ? `${p.id} query copied.` : 'Copy blocked by the browser.')}
                >
                  Copy the {p.id} query
                </CopyButton>

                <div>
                  <p className="mono eyebrow" style={{ margin: '0 0 4px' }}>
                    HOW TO READ IT
                  </p>
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--body)' }}>
                    {p.howToRead}
                  </p>
                  {c?.note ? (
                    <p style={{ margin: '6px 0 0', fontSize: 11.5, lineHeight: 1.55, color: 'var(--dim)' }}>
                      From this run: {c.note}
                    </p>
                  ) : null}
                </div>

                {c?.table ? (
                  <details className="astable">
                    <summary>
                      {c.title} — the {c.table.rows.length} row
                      {c.table.rows.length === 1 ? '' : 's'} this run produced
                    </summary>
                    <div className="table-scroll">
                      <table className="dtable mono">
                        <thead>
                          <tr>
                            {c.table.head.map((h) => (
                              <th key={h}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {c.table.rows.slice(0, 25).map((r, i) => (
                            <tr key={i}>
                              {r.map((cell, j) => (
                                <td key={j}>{String(cell)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ) : null}

                <PhaseNote phase={p.n} writeBack={p.writeBack} onSaved={touch} say={say} />
              </div>
            ) : null}
          </article>
        );
      })}

      <p className="card-note">
        Notes are stored on the committed run, so they belong to the week they were written in. A
        new commit for a new week starts a fresh set — that is deliberate: last week&apos;s reading
        of the fleet is not this week&apos;s.
      </p>
    </Sheet>
  );
}

function PhaseNote({
  phase,
  writeBack,
  onSaved,
  say,
}: {
  phase: number;
  writeBack: string;
  onSaved: () => void;
  say: (m: string) => void;
}) {
  const stored = sentinel.getPhaseNote(phase);
  const [text, setText] = useState(stored);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setText(sentinel.getPhaseNote(phase));
    setDirty(false);
  }, [phase]);

  return (
    <div className="field">
      <label className="field-label" htmlFor={`note-p${phase}`}>
        What you found — {writeBack}
      </label>
      <textarea
        id={`note-p${phase}`}
        className="mono textarea"
        rows={3}
        spellCheck={false}
        value={text}
        placeholder="Written for whoever runs this next week, including you."
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!dirty}
          onClick={() => {
            sentinel.savePhaseNote(phase, text);
            setDirty(false);
            onSaved();
            say(`Note saved for P${phase}.`);
          }}
        >
          Save note
        </button>
        <span style={{ fontSize: 10.5, color: dirty ? 'var(--amber)' : 'var(--dim)' }}>
          {dirty ? 'Unsaved' : stored ? 'Saved on this run' : 'Empty'}
        </span>
      </div>
    </div>
  );
}

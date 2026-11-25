/* ============================================================
   InvestigatePanel.tsx — Stage 3 asks for one thing: a finding.

   The finding is applied through the core's own path:
     parseFindings(line) -> applyFindings(parsed, 'investigate', store)
   which writes to run.overlay and journals every field to the
   changelog. The frozen baseline row is never touched.
   ============================================================ */

import { useEffect, useState } from 'react';
import { ArrowRight, Layers } from 'lucide-react';
import type { Device } from '@/core/types';
import { p7Query, FINDING_FORMAT } from '@/core/nql';
import { parseFindings } from '@/core/investigate';
import { applyFindings } from '@/core/handoff';
import { sentinel } from '@/store/sentinel.store';
import { CopyButton } from '@/app/components/bits';
import { PanelShell } from './PanelShell';

/** Turn a recorded overlay back into the one-line format, for re-editing. */
export function overlayToLine(overlay: Record<string, unknown>): string {
  const keys = ['state', 'component', 'cause', 'action', 'owner', 'note'];
  return keys
    .filter((k) => overlay[k] != null && String(overlay[k]) !== '')
    .map((k) => `${k}=${String(overlay[k])}`)
    .join('; ');
}

export function InvestigatePanel({
  row,
  overlay,
  onRecorded,
  onAdvance,
  onPhases,
  say,
}: {
  row: Device;
  overlay: Record<string, unknown>;
  onRecorded: () => void;
  onAdvance: () => void;
  /** opens the fleet-level phases sheet — P1-P7, which are not per-device */
  onPhases: () => void;
  say: (m: string) => void;
}) {
  const recorded = overlayToLine(overlay);
  const [text, setText] = useState(recorded);
  const [err, setErr] = useState<string | null>(null);

  // a new machine means a new finding box
  useEffect(() => {
    setText(recorded);
    setErr(null);
  }, [row.name, recorded]);

  const query = p7Query(row.name);

  function record(advance: boolean) {
    const line = `${row.name}: ${text.trim()}`;
    const parsed = parseFindings(line);
    if (!parsed.length) {
      setErr(`Nothing parsed. Use ${FINDING_FORMAT.slice(0, 40)}…`);
      return;
    }
    const res = applyFindings(parsed, 'investigate', sentinel);
    if (!res.applied) {
      setErr('That device is not in the committed run.');
      return;
    }
    setErr(null);
    onRecorded();
    say(`Finding recorded for ${row.name}.`);
    if (advance) onAdvance();
  }

  return (
    <PanelShell
      stage="STAGE 3 · INVESTIGATE"
      ask="This stage asks for one thing: a finding."
      hint="Run the query in Nexthink, paste what it said, move to the next machine."
      foot={
        <>
          <span>Same machine, later this week:</span>
          <span className="mono chip">WORK · draft the proactive ticket, set state</span>
          <span className="mono chip">CLOSE · record the outcome</span>
          <span style={{ marginLeft: 'auto' }}>The fleet, not this machine:</span>
          <button type="button" className="mono chip" onClick={onPhases}>
            <Layers size={11} aria-hidden style={{ verticalAlign: -1, marginRight: 4 }} />
            P1–P7 PHASES
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="mono"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--purple)',
              padding: '1px 6px',
              borderRadius: 4,
              background: 'rgb(188 140 255 / 0.14)',
            }}
          >
            P7
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>
            Single-device deep dive · name already filled in
          </span>
        </div>
        <pre className="mono code" style={{ maxHeight: 190 }} aria-label={`Phase 7 query for ${row.name}`}>
          {query}
        </pre>
        <CopyButton className="btn btn-teal" text={query} onDone={(ok) => say(ok ? 'Query copied.' : 'Copy blocked by the browser.')}>
          Copy query
        </CopyButton>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600 }} htmlFor="finding">
          What Nexthink found for <span className="mono">{row.name}</span>
        </label>
        <textarea
          id="finding"
          className="mono textarea"
          style={{ minHeight: 130, borderStyle: 'dashed' }}
          value={text}
          spellCheck={false}
          placeholder={FINDING_FORMAT}
          onChange={(e) => setText(e.target.value)}
        />
        <p style={{ fontSize: 10.5, color: 'var(--dim)', margin: 0 }}>
          Keys Sentinel reads: <span className="mono">state · component · cause · action · owner · note</span>.
          It overlays the frozen baseline — it never overwrites it.
        </p>
        {err ? (
          <p style={{ fontSize: 11.5, color: 'var(--red)', margin: 0 }} role="alert">
            {err}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => record(true)}>
            Record finding · next machine
            <ArrowRight size={12} aria-hidden />
          </button>
          <button type="button" className="btn" onClick={() => record(false)} title="Record and stay on this machine">
            Record
          </button>
        </div>
      </div>
    </PanelShell>
  );
}

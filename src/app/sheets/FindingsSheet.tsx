/* ============================================================
   FindingsSheet.tsx — findings in, in bulk.

   The per-device return leg lives in the Investigate panel. This is the
   other one the original console had: the assistant hands back a block of
   lines, one device per line, and the whole block lands at once.

   Nothing is applied until the operator has seen the parse. The
   preview is `parseFindings()` — the same function that does the
   applying — so what the table shows is exactly what will be written,
   including which lines were ignored and which devices are not in the
   committed run. Applying goes through `applyFindings()`, so every
   field is journalled to the changelog and the frozen baseline is
   never touched.
   ============================================================ */

import { useMemo, useState } from 'react';
import { CheckCheck, TriangleAlert } from 'lucide-react';
import { parseFindings } from '@/core/investigate';
import { applyFindings } from '@/core/handoff';
import { FINDING_FORMAT } from '@/core/nql';
import { sentinel, useSentinelStore } from '@/store/sentinel.store';
import { useRun } from '@/app/lib/derived';
import { Sheet } from '@/app/components/Sheet';

const FIELDS = ['state', 'component', 'cause', 'action', 'owner', 'note'] as const;

export function FindingsSheet({ onClose, say }: { onClose: () => void; say: (m: string) => void }) {
  const run = useRun();
  const touch = useSentinelStore((s) => s.touch);
  const [text, setText] = useState('');
  const [applied, setApplied] = useState<{ n: number; unknown: string[] } | null>(null);

  const parsed = useMemo(() => parseFindings(text), [text]);
  const known = useMemo(() => new Set((run?.rows ?? []).map((r) => r.name)), [run]);
  const nonEmptyLines = text.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t && !t.startsWith('#') && !t.startsWith('//');
  }).length;
  const ignored = Math.max(0, nonEmptyLines - parsed.length);
  const unknownRows = parsed.filter((p) => !known.has(p.device));
  const willApply = parsed.length - unknownRows.length;

  function apply() {
    const res = applyFindings(parsed, 'copilot', sentinel);
    touch();
    setApplied({ n: res.applied, unknown: res.unknown });
    say(
      `${res.applied} finding${res.applied === 1 ? '' : 's'} applied${
        res.unknown.length ? `, ${res.unknown.length} unknown device(s) skipped` : ''
      }.`,
    );
  }

  return (
    <Sheet
      title="Findings in"
      subtitle={
        <>
          Paste the assistant&apos;s block back. One device per line, in the format the scoped package asked
          for. Nothing is written until you have read the parse.
        </>
      }
      closeLabel="Close the findings sheet"
      onClose={onClose}
      width={720}
      foot={
        <>
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
            {parsed.length ? (
              <>
                <b className="mono" style={{ color: 'var(--txt)' }}>
                  {willApply}
                </b>{' '}
                of {parsed.length} parsed line{parsed.length === 1 ? '' : 's'} will be applied
                {unknownRows.length ? ` · ${unknownRows.length} unknown device(s) skipped` : ''}
                {ignored ? ` · ${ignored} line(s) unparseable` : ''}
              </>
            ) : (
              'Nothing parsed yet.'
            )}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginLeft: 'auto' }}
            disabled={!run || willApply === 0}
            onClick={apply}
          >
            <CheckCheck size={13} aria-hidden />
            Apply {willApply || ''} finding{willApply === 1 ? '' : 's'} as an overlay
          </button>
        </>
      }
    >
      {!run ? (
        <p className="err" role="alert">
          <TriangleAlert size={12} aria-hidden style={{ flex: 'none', marginTop: 1 }} />
          There is no committed run to overlay findings onto. Commit this week&apos;s export first.
        </p>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="bulk-findings">
          Assistant findings block
        </label>
        <textarea
          id="bulk-findings"
          className="mono textarea"
          rows={8}
          spellCheck={false}
          value={text}
          placeholder={`L-100110: ${FINDING_FORMAT}\nL-100228: state=triaged; component=SSD; cause=disk latency; action=replace`}
          onChange={(e) => {
            setText(e.target.value);
            setApplied(null);
          }}
        />
        <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
          Keys read: <span className="mono">{FIELDS.join(' · ')}</span>. Lines starting{' '}
          <span className="mono">#</span> or <span className="mono">//</span> are comments. Anything
          else is skipped and counted below rather than guessed at.
        </span>
      </div>

      {parsed.length ? (
        <div className="table-wrap">
          <div
            className="mono"
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--panel-2)',
              fontSize: 10.5,
              color: 'var(--dim)',
              letterSpacing: '0.06em',
            }}
          >
            PREVIEW · {parsed.length} row{parsed.length === 1 ? '' : 's'} parsed
          </div>
          <div className="table-scroll" style={{ maxHeight: 260 }}>
            <table className="dtable" style={{ width: '100%' }}>
              <caption className="sr-only">
                Every parsed line, with the fields it will write
              </caption>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 12 }}>Device</th>
                  <th>State</th>
                  <th>Component</th>
                  <th>Cause</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p, i) => {
                  const missing = !known.has(p.device);
                  return (
                    <tr key={`${p.device}-${i}`} style={missing ? { opacity: 0.75 } : undefined}>
                      <td className="mono" style={{ paddingLeft: 12, fontWeight: 700 }}>
                        {p.device}
                        {missing ? (
                          <span
                            className="tag tag-overridden"
                            style={{ marginLeft: 6, whiteSpace: 'nowrap' }}
                          >
                            not in this run
                          </span>
                        ) : null}
                      </td>
                      {(['state', 'component', 'cause', 'action'] as const).map((f) => (
                        <td
                          key={f}
                          className="mono"
                          style={{ color: p.changes[f] ? 'var(--assist)' : 'var(--dim)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={p.changes[f] ?? ''}
                        >
                          {p.changes[f] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {unknownRows.length ? (
        <p className="err" role="alert">
          <TriangleAlert size={12} aria-hidden style={{ flex: 'none', marginTop: 1 }} />
          {unknownRows.length} device name
          {unknownRows.length === 1 ? ' is' : 's are'} not in the committed run —{' '}
          <span className="mono">{unknownRows.slice(0, 4).map((r) => r.device).join(', ')}</span>
          {unknownRows.length > 4 ? ` +${unknownRows.length - 4}` : ''}. They are skipped, not
          created.
        </p>
      ) : null}

      {applied ? (
        <p className="ok-line" role="status">
          Applied {applied.n} finding{applied.n === 1 ? '' : 's'} to the overlay
          {applied.unknown.length ? `, skipped ${applied.unknown.length} unknown device(s)` : ''}.
          Every field change is in the changelog; the frozen baseline is untouched.
        </p>
      ) : null}

      <p className="card-note">
        An overlay sits on top of the frozen run. It is what the dossier, the reports and the
        roundup read — and the baseline row underneath it is never rewritten, so you can always see
        what the export originally said.
      </p>
    </Sheet>
  );
}

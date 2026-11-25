/* ============================================================
   ReportsRoute.tsx — the three reports, generated from the committed
   run and the changelog.

   Copy-paste ready by design: no hyperlinks, no reference markers, no
   sign-off block. The metrics box is the one place the analyst's own
   words enter a report, and they are used EXACTLY as given — never
   restated, never rounded, never invented. That is the ported
   generator's contract and this screen does not add to it.

   Reachable from the Close stage's footer chips and from /reports.
   ============================================================ */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { reportExecBrief, reportFourQuestions, reportWeeklyStatus } from '@/core/reports';
import { cfg, sentinel } from '@/store/sentinel.store';
import { downloadText } from '@/lib/clipboard';
import { useRun } from '@/app/lib/derived';
import { CopyButton, LiveRegion, useAnnouncer } from '@/app/components/bits';
import { FirstRun } from '@/app/components/FirstRun';

export const REPORTS = [
  {
    id: 'four',
    label: 'Four Questions',
    file: 'four-questions',
    blurb: 'The four the leadership deck asks, in the order it asks them.',
    takesMetrics: true,
  },
  {
    id: 'status',
    label: 'Weekly Status',
    file: 'weekly-status',
    blurb: 'The prose update: what the queue held, what moved, what is next.',
    takesMetrics: true,
  },
  {
    id: 'exec',
    label: 'Executive Brief',
    file: 'executive-brief',
    blurb: 'One paragraph and five bullets. No metrics box — it quotes the run only.',
    takesMetrics: false,
  },
] as const;

export type ReportId = (typeof REPORTS)[number]['id'];

export function ReportsRoute() {
  const run = useRun();
  const [params, setParams] = useSearchParams();
  const requested = params.get('r');
  const active: ReportId = (REPORTS.find((r) => r.id === requested)?.id ?? 'four') as ReportId;
  const [metrics, setMetrics] = useState('');
  const [msg, say] = useAnnouncer();

  const spec = REPORTS.find((r) => r.id === active)!;
  const text = useMemo(() => {
    if (!run) return '';
    const m = spec.takesMetrics && metrics.trim() ? metrics : null;
    return active === 'four'
      ? reportFourQuestions(run, m, cfg, sentinel)
      : active === 'status'
        ? reportWeeklyStatus(run, m, cfg, sentinel)
        : reportExecBrief(run, cfg, sentinel);
  }, [run, active, metrics, spec.takesMetrics]);

  if (!run) {
    return (
      <FirstRun
        title="Reports"
        what="the Four Questions, the Weekly Status and the Executive Brief, all generated from the committed run and this week's changelog"
      />
    );
  }

  return (
    <div className="stage-page">
      <div className="lens" style={{ maxWidth: 1020 }}>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Reports</h1>
          <p>
            Week ending {run.weekEnding} · generated from the committed run and the changelog, never
            from memory
          </p>
        </div>

        <div className="segment" style={{ gridAutoFlow: 'column', display: 'inline-grid', width: 'fit-content' }}>
          {REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={active === r.id}
              onClick={() => setParams(r.id === 'four' ? {} : { r: r.id }, { replace: true })}
              style={
                active === r.id
                  ? {
                      color: 'var(--teal-l)',
                      borderColor: 'var(--teal-d)',
                      background: 'rgb(45 212 191 / 0.1)',
                    }
                  : undefined
              }
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="lens-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
          <section className="card" aria-label={spec.label}>
            <div className="card-head">
              <h2 className="card-title">{spec.label}</h2>
              <span className="mono card-sub">markdown · {text.split('\n').length} lines</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <CopyButton
                  className="btn btn-sm btn-teal"
                  text={() => text}
                  onDone={(ok) =>
                    say(ok ? `${spec.label} copied.` : 'Copy blocked by the browser.')
                  }
                >
                  Copy
                </CopyButton>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    downloadText(`sentinel-${spec.file}-${run.weekEnding}.md`, text);
                    say(`${spec.label} downloaded.`);
                  }}
                >
                  <Download size={12} aria-hidden />
                  Download .md
                </button>
              </span>
            </div>
            <p className="card-sub">{spec.blurb}</p>
            <pre className="report-out" data-testid="report-output">
              {text}
            </pre>
          </section>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <section className="card" aria-label="Your metrics">
              <div className="card-head">
                <h2 className="card-title">Your metrics</h2>
              </div>
              <label className="field-label" htmlFor="metrics">
                One per line. Used exactly as given.
              </label>
              <textarea
                id="metrics"
                className="mono textarea"
                rows={7}
                spellCheck={false}
                value={metrics}
                disabled={!spec.takesMetrics}
                placeholder={'14 proactive tickets raised\n3 devices refreshed early\n0 escalations'}
                onChange={(e) => setMetrics(e.target.value)}
              />
              <p className="card-note">
                {spec.takesMetrics ? (
                  <>
                    Sentinel does not restate, round, or invent a figure you type here. It is
                    appended verbatim, in your words, and it is the only part of the report the
                    console did not compute.
                  </>
                ) : (
                  <>
                    The Executive Brief takes no metrics box — it quotes the run and nothing else.
                    Switch to Four Questions or Weekly Status to add yours.
                  </>
                )}
              </p>
            </section>

            <section className="card" aria-label="What goes into these">
              <div className="card-head">
                <h2 className="card-title">What goes into these</h2>
              </div>
              <dl className="kv">
                <dt>run</dt>
                <dd className="mono">{run.weekEnding}</dd>
                <dt>in scope</dt>
                <dd className="mono">{run.summary.inScope}</dd>
                <dt>changelog</dt>
                <dd className="mono">{sentinel.getChangelog().length} entries</dd>
                <dt>outcomes</dt>
                <dd className="mono">{sentinel.getOutcomes().length}</dd>
              </dl>
              <p className="card-note">
                &ldquo;Actions taken this week&rdquo; and &ldquo;What improved&rdquo; are read from
                the whole changelog, not just this week&apos;s entries — a preserved behaviour of the
                original console (B-06), so a Week 3 report will still claim Week 1&apos;s
                resolutions until the changelog is cleared. It is listed as a known bug in the
                README rather than quietly fixed in a port.
              </p>
            </section>
          </aside>
        </div>
      </div>
      <LiveRegion message={msg} />
    </div>
  );
}

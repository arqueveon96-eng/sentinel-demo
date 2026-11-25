/* ============================================================
   PullRoute.tsx — Stage 1. Get the week's export in, look at what
   arrived, then freeze it.

   Two deliberate steps. Choosing files runs the whole ported chain and
   shows the ingest report, but commits nothing; "Commit run & score"
   is the act that freezes the baseline. The console never overwrites a
   baseline behind the operator's back, and this is where that promise
   is kept — so the button says what it will replace.
   ============================================================ */

import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleAlert, FileUp, Loader2, TriangleAlert } from 'lucide-react';
import type { IngestReport, SourceFile } from '@/core/types';
import { buildRun } from '@/core/pipeline';
import { cfg, sentinel, useSentinelStore } from '@/store/sentinel.store';
import { useRun } from '@/app/lib/derived';
import { useUi } from '@/app/lib/ui.store';
import { LiveRegion, useAnnouncer } from '@/app/components/bits';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const GATE_COLOR: Record<string, string> = {
  clean: 'var(--green)',
  review: 'var(--amber)',
  block: 'var(--red)',
};

export function PullRoute() {
  const navigate = useNavigate();
  const ingest = useSentinelStore((s) => s.ingest);
  const committed = useRun();
  const staged = useUi((s) => s.staged);
  const setStaged = useUi((s) => s.setStaged);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [report, setReport] = useState<IngestReport | null>(null);
  const [weekEnding, setWeekEnding] = useState(committed?.weekEnding ?? today());
  const [error, setError] = useState<string | null>(null);
  const [msg, say] = useAnnouncer();

  const read = useCallback(
    async (list: FileList | File[] | null) => {
      const arr = list ? Array.from(list) : [];
      if (!arr.length) return;
      setBusy(true);
      setError(null);
      try {
        const files: SourceFile[] = await Promise.all(
          arr.map(async (f) => ({ name: f.name, text: await f.text() })),
        );
        const { run } = buildRun(weekEnding, files, cfg, sentinel.currentRun());
        setStaged(files);
        setReport(run.report);
        say(`${run.report.deviceCount} rows read from ${files.length} file(s). Nothing committed yet.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [weekEnding, setStaged, say],
  );

  function commit() {
    if (!staged.length) return;
    setBusy(true);
    try {
      const { run } = ingest(weekEnding, staged);
      setStaged([]);
      setReport(null);
      say(`Run committed — ${run.summary.inScope} devices in scope.`);
      navigate('/score');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage-page">
      <div className="page-head">
        <h1 className="page-title">Pull the week in</h1>
        <p>
          Merge is fill-gaps, first file wins — load the most complete export first. Nothing is
          frozen until you commit.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div
            className={`drop${over ? ' is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void read(e.dataTransfer.files);
            }}
          >
            <FileUp size={22} aria-hidden style={{ color: 'var(--teal)' }} />
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
              Drop the Phase 4 export here
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>
              CSV, one or many. Or choose them:
            </p>
            <input
              ref={inputRef}
              id="csv-input"
              data-testid="csv-input"
              type="file"
              accept=".csv,text/csv"
              multiple
              className="sr-only"
              onChange={(e) => void read(e.target.files)}
            />
            <button
              type="button"
              className="btn btn-teal"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <FileUp size={14} aria-hidden />}
              Choose CSV
            </button>
            {staged.length ? (
              <p className="mono" style={{ margin: 0, fontSize: 11.5, color: 'var(--dim-hi)' }}>
                {staged.map((f) => f.name).join(' · ')}
              </p>
            ) : null}
          </div>

          {error ? (
            <p data-testid="ingest-error" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--red)', fontSize: 13 }} role="alert">
              <TriangleAlert size={16} aria-hidden />
              {error}
            </p>
          ) : null}

          {report ? <Report report={report} /> : null}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', borderRadius: 11, background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <p className="mono eyebrow" style={{ margin: 0 }}>
            COMMIT
          </p>
          <div className="field">
            <label className="field-label" htmlFor="week">
              Week ending
            </label>
            <input
              id="week"
              className="mono input"
              type="date"
              value={weekEnding}
              onChange={(e) => setWeekEnding(e.target.value)}
            />
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--dim)', margin: 0, lineHeight: 1.55 }}>
            {committed ? (
              <>
                A run is already frozen for{' '}
                <b className="mono" style={{ color: 'var(--txt)' }}>{committed.weekEnding}</b> with{' '}
                <span className="mono">{committed.rows.length}</span> rows. Committing replaces it as
                the baseline; findings and outcomes already recorded are kept.
              </>
            ) : (
              'No baseline yet. Committing freezes this run and scores the fleet.'
            )}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!staged.length || busy || report?.gate === 'block'}
            onClick={commit}
          >
            Commit run &amp; score
          </button>
          {report?.gate === 'block' ? (
            <p style={{ fontSize: 11.5, color: 'var(--red)', margin: 0 }}>
              The ingest gate says block — a required column is missing. Fix the export rather than
              scoring around it.
            </p>
          ) : null}
        </aside>
      </div>
      <LiveRegion message={msg} />
    </div>
  );
}

function Report({ report: r }: { report: IngestReport }) {
  const missing = r.coverage.filter((c) => !c.present);
  return (
    <div data-testid="ingest-report" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="kpi-row">
        <Kpi label="Devices" value={r.deviceCount} testid="stat-devices" />
        <Kpi label="Rejected rows" value={r.rejected} testid="stat-rejected" tone={r.rejected ? 'var(--amber)' : undefined} />
        <Kpi label="HRI mode" value={r.hriMode} testid="stat-hrimode" tone={r.hriMode === 'counts' ? 'var(--green)' : 'var(--amber)'} />
        <Kpi label="Gate" value={r.gate} testid="stat-gate" tone={GATE_COLOR[r.gate]} />
      </div>

      {r.anomalies.length ? (
        <ul data-testid="anomalies" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {r.anomalies.map((a) => (
            <li key={a} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--amber)' }}>
              <CircleAlert size={14} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
              {a}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="table-wrap">
        <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)', fontSize: 11, color: 'var(--dim)', letterSpacing: '0.06em' }} className="mono">
          COLUMN COVERAGE · {r.coverage.length - missing.length}/{r.coverage.length} resolved
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 0 }}>
          {r.coverage.map((c) => (
            <div
              key={c.field}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'baseline',
                padding: '7px 14px',
                borderBottom: '1px solid var(--line-2)',
                fontSize: 11.5,
                minWidth: 0,
              }}
            >
              <span
                className="mono"
                style={{ color: c.present ? 'var(--green)' : c.req ? 'var(--red)' : 'var(--dim)', flex: 'none' }}
                aria-hidden
              >
                {c.present ? '+' : c.req ? '!' : '·'}
              </span>
              <span style={{ flex: 'none' }}>{c.field}</span>
              <span className="mono" style={{ color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.column ?? (c.req ? 'required — missing' : 'not in export')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mono" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
        {r.perFile.map((f) => (
          <div key={f.file}>
            {f.file}: {f.shape ?? f.err}
            {f.rejected ? ` · ${f.rejected} rejected` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  testid,
  tone,
}: {
  label: string;
  value: string | number;
  testid: string;
  tone?: string;
}) {
  return (
    <div className="kpi" style={tone ? { borderTopColor: tone } : undefined}>
      <span className="mono kpi-value" data-testid={testid} style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

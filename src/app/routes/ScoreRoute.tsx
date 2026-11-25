/* ============================================================
   ScoreRoute.tsx — Stage 2. What the run says about the fleet, and
   which machines it wants you to look at.

   The dispatch ladder is not decoration: its five rungs are the exact
   ranks queueReason() sorts on, so the counts here and the groups in
   the picker are the same numbers by construction.

   Clicking a row selects that device and opens it in Investigate.
   ============================================================ */

import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowUpRight, Search } from 'lucide-react';
import type { Device } from '@/core/types';
import { queueReason } from '@/core/queue';
import { whyLine } from '@/core/verdict';
import { p7Query } from '@/core/nql';
import { fmt } from '@/core/format';
import { cfg, sentinel } from '@/store/sentinel.store';
import { useQueue, useRun, useTriage } from '@/app/lib/derived';
import { useUi } from '@/app/lib/ui.store';
import { reasonLook, sevLook } from '@/app/lib/severity';
import { Glyph } from '@/app/components/Glyph';
import { CopyButton, LiveRegion, useAnnouncer } from '@/app/components/bits';

const LENSES = [
  { id: 'queue', label: 'Queue' },
  { id: 'ch', label: 'CRITICAL + HIGH' },
  { id: 'hri', label: 'HRI watchlist' },
  { id: 'hidden', label: 'Hidden risk' },
  { id: 'all', label: 'All scored' },
] as const;
type LensId = (typeof LENSES)[number]['id'];

export function ScoreRoute() {
  const navigate = useNavigate();
  const run = useRun();
  const queue = useQueue();
  const triage = useTriage();
  const select = useUi((s) => s.select);
  const [lens, setLens] = useState<LensId>('queue');
  const [rung, setRung] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [msg, say] = useAnnouncer();

  const rows = useMemo<Device[]>(() => {
    if (!run) return [];
    const scored = run.rows.filter((r) => !r.excluded);
    const base =
      lens === 'queue'
        ? triage
        : lens === 'ch'
          ? scored.filter((r) => r.tier === 'CRITICAL' || r.tier === 'HIGH')
          : lens === 'hri'
            ? scored.filter((r) => r.hri != null && r.hri >= cfg.hriBand.WATCH)
            : lens === 'hidden'
              ? scored.filter((r) => r.hidden)
              : scored;
    const sorted =
      lens === 'queue' ? base : base.slice().sort((a, b) => (b.crs as number) - (a.crs as number));
    const byRung = rung ? sorted.filter((r) => queueReason(r, cfg).label === rung) : sorted;
    const t = q.trim().toLowerCase();
    return t
      ? byRung.filter((r) =>
          [r.name, r.user, r.model, r.driver, r.lastBugcheck]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(t)),
        )
      : byRung;
  }, [run, triage, lens, rung, q]);

  const ladder = useMemo(() => {
    const counts: Record<string, number> = {};
    queue.forEach((r) => (counts[r.reason.label] = (counts[r.reason.label] || 0) + 1));
    return ['FAILING', 'HIDDEN RISK', 'CRITICAL', 'DEGRADING', 'HIGH', 'WATCH']
      .filter((l) => counts[l])
      .map((l) => ({ label: l, n: counts[l] }));
  }, [queue]);

  if (!run) {
    return (
      <div className="stage-page">
        <div className="page-head">
          <h1 className="page-title">Nothing is scored yet</h1>
          <p>Commit a run and this fills in.</p>
        </div>
        <Link className="btn btn-primary" to="/pull" style={{ width: 'fit-content' }}>
          Go to Pull
        </Link>
      </div>
    );
  }

  const s = run.summary;
  function open(name: string) {
    select(name, 1);
    navigate('/investigate');
  }

  return (
    <div className="stage-page" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        {/* The title is the way up a level: this stage is the dispatch list,
            and the question behind it — what shape is the whole estate in —
            is Fleet's. */}
        <h1 className="page-title">
          <Link
            to="/fleet"
            style={{ color: 'inherit', textDecoration: 'none' }}
            title="See the whole fleet, not just the queue"
          >
            {queue.length} of {s.inScope} need a look this week
            <ArrowUpRight size={16} aria-hidden style={{ color: 'var(--teal)', marginLeft: 6, verticalAlign: 1 }} />
          </Link>
        </h1>
        <p>
          Baseline frozen {run.weekEnding}. Percentile rank is relative — it is never absolute risk.
        </p>
      </div>

      <div className="kpi-row">
        <Kpi label="Scored, in scope" value={s.inScope} />
        <Kpi label="CRITICAL" value={s.tierCounts.CRITICAL ?? 0} tone="var(--red)" />
        <Kpi label="HIGH" value={s.tierCounts.HIGH ?? 0} tone="var(--amber)" />
        <Kpi label="FAILING" value={s.sevCounts.FAILING ?? 0} tone="var(--red)" />
        <Kpi label="DEGRADING" value={s.sevCounts.DEGRADING ?? 0} tone="var(--amber)" />
        <Kpi label="Hidden risk" value={s.hidden} tone="var(--purple)" />
      </div>

      <div className="ladder">
        <span className="mono ladder-key">DISPATCH</span>
        {ladder.map((r) => {
          const look = reasonLook(r.label);
          return (
            <button
              key={r.label}
              type="button"
              aria-pressed={rung === r.label}
              onClick={() => setRung(rung === r.label ? null : r.label)}
              style={{
                color: look.color,
                background: `color-mix(in srgb, ${look.color} 13%, transparent)`,
              }}
            >
              <Glyph mark={look.mark} color={look.color} size={9} />
              {r.label} <span className="mono">{r.n}</span>
            </button>
          );
        })}
        {rung ? (
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setRung(null)}>
            Clear
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="segment" style={{ gridAutoFlow: 'column', display: 'inline-grid' }}>
          {LENSES.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={lens === l.id}
              onClick={() => setLens(l.id)}
              style={
                lens === l.id
                  ? { color: 'var(--teal-l)', borderColor: 'var(--teal-d)', background: 'rgb(45 212 191 / 0.1)' }
                  : undefined
              }
            >
              {l.label}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <Search size={14} aria-hidden style={{ color: 'var(--dim)' }} />
          <span className="sr-only">Search the scored fleet</span>
          <input
            className="mono input"
            style={{ width: 220 }}
            type="search"
            value={q}
            placeholder="device, owner, model, bugcheck"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      <div className="table-wrap" style={{ flex: 1 }}>
        <div className="mono thead">
          <span />
          <span>DEVICE</span>
          <span>OWNER</span>
          <span>WHY IT IS HERE</span>
          <span className="num">CRS</span>
          <span className="num">HRI</span>
          <span>FINDING</span>
          <span />
        </div>
        <div className="table-scroll">
          {rows.length === 0 ? (
            <p className="picker-empty">Nothing matches that.</p>
          ) : null}
          {rows.slice(0, 300).map((r) => {
            const look = reasonLook(queueReason(r, cfg).label);
            const finding = sentinel.getOverlay(r.name as string);
            const has = Object.keys(finding).length > 0;
            return (
              <div key={r.name} className="trow" style={{ borderLeftColor: look.color }}>
                <Glyph mark={look.mark} color={look.color} label={queueReason(r, cfg).label} />
                <button
                  type="button"
                  className="mono"
                  style={{
                    fontWeight: 700,
                    background: 'none',
                    border: 0,
                    padding: 0,
                    color: 'var(--txt)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                  }}
                  onClick={() => open(r.name as string)}
                  title={`Open ${r.name} in Investigate`}
                >
                  {r.name}
                </button>
                <span style={{ color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.user || '—'}
                </span>
                <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }} title={whyLine(r)}>
                  {whyLine(r)}
                </span>
                <span className="mono num" style={{ fontWeight: 700 }}>
                  {fmt(r.crs)}
                </span>
                <span className="mono num" style={{ color: sevLook(r.sev).color }}>
                  {r.hri == null ? '—' : fmt(r.hri)}
                </span>
                <span style={{ fontSize: 12, color: has ? 'var(--assist)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {has ? String(finding.state ?? 'recorded') : 'not yet'}
                </span>
                <CopyButton
                  className="btn btn-sm btn-teal"
                  text={() => p7Query(r.name)}
                  onDone={(ok) => say(ok ? `P7 query for ${r.name} copied.` : 'Copy blocked by the browser.')}
                  title={`Copy the Phase 7 query for ${r.name}`}
                >
                  P7 query
                </CopyButton>
              </div>
            );
          })}
        </div>
        {rows.length > 300 ? (
          <p className="picker-empty">
            {rows.length - 300} more, in the same order. Narrow with the search or the ladder.
          </p>
        ) : null}
      </div>
      <LiveRegion message={msg} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="kpi" style={tone ? { borderTopColor: tone } : undefined}>
      <span className="mono kpi-value" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

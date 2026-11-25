/* ============================================================
   FleetRoute.tsx — the fleet-level read.

   The Score stage answers "what do I work this week". This answers
   "what shape is the estate in", which is a different question and
   deserves a different screen: composition first, then what moved since
   the last committed run, then the top of the queue as a way back in.

   Everything on it is `run.summary` or `trendPoints` — no number is
   computed a second way here. Where the prior week's record does not
   hold a figure, the row says "not recorded" instead of a delta.
   ============================================================ */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, TrendingUp } from 'lucide-react';
import type { Tier } from '@/core/types';
import { currentConfig } from '@/core/config';
import { queueReason } from '@/core/queue';
import { whyLine } from '@/core/verdict';
import { fmt } from '@/core/format';
import {
  BAND_ORDER,
  TIER_ORDER,
  deltaRows,
  deltaTone,
  fmtDelta,
  readRunMeta,
  trendPoints,
  type DeltaRow,
} from '@/core/trends';
import { cfg, sentinel } from '@/store/sentinel.store';
import { useBlob, useQueue, useRun } from '@/app/lib/derived';
import { useUi } from '@/app/lib/ui.store';
import { reasonLook, sevLook, tierLook } from '@/app/lib/severity';
import { Glyph } from '@/app/components/Glyph';
import { TIER_FILL, onFill } from '@/app/components/charts';
import { FirstRun } from '@/app/components/FirstRun';

const BAND_COLOR: Record<string, string> = {
  FAILING: 'var(--red)',
  DEGRADING: 'var(--amber)',
  WATCH: 'var(--amber)',
  STABLE: 'var(--green)',
};

export function FleetRoute() {
  const navigate = useNavigate();
  const run = useRun();
  const queue = useQueue();
  const blob = useBlob();
  const select = useUi((s) => s.select);

  const points = useMemo(
    () => trendPoints(blob.runHistory, readRunMeta(blob)),
    [blob],
  );

  const excluded = useMemo(() => {
    const rows = run?.rows.filter((r) => r.excluded) ?? [];
    const owners = new Map<string, number>();
    rows.forEach((r) => owners.set(r.user || '—', (owners.get(r.user || '—') || 0) + 1));
    return {
      devices: rows.length,
      owners: [...owners.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [run]);

  if (!run) {
    return (
      <FirstRun
        title="Fleet"
        what="the composition of every scored device — tiers, HRI bands, hidden risk and what moved since last week"
      />
    );
  }

  const s = run.summary;
  const cur = points[points.length - 1] ?? null;
  const prev = points.length >= 2 ? points[points.length - 2] : null;
  const deltas = cur && prev ? deltaRows(prev, cur) : null;
  const patterns = currentConfig(cfg, sentinel).excludeSrc;
  const hriUnavailable = s.inScope - s.hriAvail;

  function open(name: string) {
    select(name, 1);
    navigate('/investigate');
  }

  return (
    <div className="stage-page">
      <div className="lens">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Fleet</h1>
          <p>
            {s.inScope} devices in scope for the week ending {run.weekEnding} · {s.excluded}{' '}
            excluded by owner · avg composite CRS {s.avgCRS} · avg DEX {s.avgDEX ?? '—'}
          </p>
        </div>

        {/* ---------- composition ---------- */}
        <section className="card" aria-label="Composite tier composition">
          <div className="card-head">
            <h2 className="card-title">Composite tier composition</h2>
            <span className="mono card-sub">CRS bands · {s.inScope} devices</span>
          </div>
          <Composition
            parts={TIER_ORDER.map((t) => ({
              label: t,
              n: s.tierCounts[t] ?? 0,
              fill: TIER_FILL[t],
            }))}
            total={s.inScope}
          />
          <p className="guard-line">
            Composite CRS is absolute. Triage rank is relative — percentile rank is never absolute
            risk.
          </p>
        </section>

        <div className="lens-row" style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)' }}>
          <section className="card" aria-label="Hardware reliability composition">
            <div className="card-head">
              <h2 className="card-title">HRI composition</h2>
              <span className="mono card-sub">hardware bands · {s.hriAvail} scored</span>
            </div>
            <Composition
              parts={[
                ...BAND_ORDER.map((b) => ({
                  label: b,
                  n: s.sevCounts[b] ?? 0,
                  fill: b === 'FAILING' ? '#f85149' : b === 'DEGRADING' ? '#f0a020' : b === 'WATCH' ? '#8a6d1f' : '#39424d',
                })),
                { label: 'NO COUNTS', n: hriUnavailable, fill: '#20272f' },
              ]}
              total={s.inScope}
            />
            <p className="card-note">
              {hriUnavailable > 0 ? (
                <>
                  <b className="mono" style={{ color: 'var(--amber)' }}>
                    {hriUnavailable}
                  </b>{' '}
                  device{hriUnavailable === 1 ? ' carries' : 's carry'} no raw event counts, so HRI
                  cannot read {hriUnavailable === 1 ? 'it' : 'them'} at all. They are not STABLE —
                  they are unmeasured.{' '}
                </>
              ) : (
                'Every in-scope device carried raw event counts, so HRI read all of them. '
              )}
              Bands stay provisional until twenty outcomes are graded.
            </p>
          </section>

          <section className="card" aria-label="Hidden risk and exclusions">
            <div className="card-head">
              <h2 className="card-title">What only HRI can see</h2>
            </div>
            <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <div className="kpi" style={{ borderTopColor: 'var(--purple)' }}>
                <span className="mono kpi-value" style={{ color: 'var(--purple)' }}>
                  {s.hidden}
                </span>
                <span className="kpi-label">Hidden risk</span>
              </div>
              <div className="kpi" style={{ borderTopColor: 'var(--amber)' }}>
                <span className="mono kpi-value" style={{ color: 'var(--amber)' }}>
                  {s.hriWatch}
                </span>
                <span className="kpi-label">HRI watchlist</span>
              </div>
            </div>
            <p className="card-note">
              Hidden risk is HRI flagging a machine the composite tier does not — the single output
              nothing else in the stack produces.
            </p>
          </section>
        </div>

        {/* ---------- excluded owners ---------- */}
        <section className="card" aria-label="Excluded owners">
          <div className="card-head">
            <h2 className="card-title">Excluded owners</h2>
            <span className="mono card-sub">
              {excluded.devices} device{excluded.devices === 1 ? '' : 's'} out of scope
            </span>
          </div>
          <p className="card-note">
            Owner patterns in{' '}
            <Link to="/config" style={{ color: 'var(--teal-l)' }}>
              Config
            </Link>
            :{' '}
            {patterns.map((p, i) => (
              <span key={p}>
                <span className="mono" style={{ color: 'var(--dim-hi)' }}>
                  {p}
                </span>
                {i < patterns.length - 1 ? ' · ' : ''}
              </span>
            ))}
          </p>
          {excluded.owners.length ? (
            <div className="table-scroll" style={{ maxHeight: 150 }}>
              <table className="dtable mono">
                <caption>Excluded accounts and how many devices each holds</caption>
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th className="num">Devices</th>
                  </tr>
                </thead>
                <tbody>
                  {excluded.owners.map(([o, n]) => (
                    <tr key={o}>
                      <td>{o}</td>
                      <td className="num">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="card-note">No owner in this export matched an exclusion pattern.</p>
          )}
        </section>

        {/* ---------- what this run changed ---------- */}
        <section className="card" aria-label="What this run changed">
          <div className="card-head">
            <h2 className="card-title">What this run changed</h2>
            <span className="mono card-sub">
              {prev ? `${prev.week} → ${cur?.week}` : 'no prior committed run'}
            </span>
          </div>
          {deltas && prev && cur ? (
            <>
              <div
                className="lens-row"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
              >
                <DeltaTable caption="By composite tier" rows={deltas.tiers} />
                <DeltaTable caption="By HRI band" rows={deltas.bands} />
                <DeltaTable caption="Fleet" rows={deltas.fleet} />
              </div>
              {deltas.tiers.some((r) => r.delta == null) ? (
                <p className="card-note">
                  A row reading <span className="mono">not recorded</span> is one the week ending{' '}
                  <span className="mono">{prev.week}</span> did not store — the run history entry the
                  console wrote then held CRITICAL and HIGH only. It is not a zero and it is not
                  drawn as one.
                </p>
              ) : null}
              <p style={{ margin: 0 }}>
                <Link className="btn btn-sm" to="/trends" style={{ width: 'fit-content' }}>
                  <TrendingUp size={12} aria-hidden />
                  See it over every committed week
                </Link>
              </p>
            </>
          ) : (
            <p className="card-note">
              This is the first committed run, so there is nothing to compare it to. There is no
              prior week — the console will not invent a delta against one. Commit next week&apos;s
              export and this fills in.
            </p>
          )}
        </section>

        {/* ---------- top of the queue ---------- */}
        <section className="card" aria-label="Top of the queue">
          <div className="card-head">
            <h2 className="card-title">Top of the queue</h2>
            <span className="mono card-sub">
              {queue.length} scoped · dispatch order · showing {Math.min(10, queue.length)}
            </span>
          </div>
          {queue.length ? (
            <div className="table-wrap">
              <div className="mono thead" style={{ gridTemplateColumns: '22px 118px 92px minmax(160px,1fr) 64px 64px 108px' }}>
                <span />
                <span>DEVICE</span>
                <span>OWNER</span>
                <span>WHY IT IS HERE</span>
                <span className="num">CRS</span>
                <span className="num">HRI</span>
                <span />
              </div>
              <div className="table-scroll">
                {queue.slice(0, 10).map((q) => {
                  const row = run.rows.find((r) => r.name === q.name)!;
                  const look = reasonLook(queueReason(row, cfg).label);
                  return (
                    <div
                      key={q.name}
                      className="trow"
                      style={{
                        borderLeftColor: look.color,
                        gridTemplateColumns: '22px 118px 92px minmax(160px,1fr) 64px 64px 108px',
                      }}
                    >
                      <Glyph mark={look.mark} color={look.color} label={q.reason.label} />
                      <span className="mono" style={{ fontWeight: 700 }}>
                        {q.name}
                      </span>
                      <span style={{ color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {q.user || '—'}
                      </span>
                      <span
                        style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={whyLine(row)}
                      >
                        {whyLine(row)}
                      </span>
                      <span className="mono num" style={{ fontWeight: 700 }}>
                        {fmt(q.crs)}
                      </span>
                      <span className="mono num" style={{ color: sevLook(q.sev).color }}>
                        {q.hri == null ? '—' : fmt(q.hri)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-teal"
                        onClick={() => open(q.name)}
                        title={`Open ${q.name} in the dossier`}
                      >
                        Dossier
                        <ArrowRight size={11} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="card-note">
              This run flagged nothing for dispatch. That is a result, not an error.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

function Composition({
  parts,
  total,
}: {
  parts: { label: string; n: number; fill: string }[];
  total: number;
}) {
  const shown = parts.filter((p) => p.n > 0);
  return (
    <>
      <div
        className="compbar"
        role="img"
        aria-label={shown.map((p) => `${p.label} ${p.n}`).join(', ')}
      >
        {shown.map((p) => {
          const pct = total ? (100 * p.n) / total : 0;
          return (
            <span
              key={p.label}
              style={{ width: `${pct}%`, background: p.fill, color: onFill(p.fill) }}
              title={`${p.label} — ${p.n} of ${total}`}
            >
              {pct > 7 ? p.n : ''}
            </span>
          );
        })}
      </div>
      <div className="complegend">
        {parts.map((p) => (
          <span key={p.label}>
            <i className="swatch" style={{ background: p.fill }} aria-hidden />
            <span style={{ color: 'var(--dim)' }}>{p.label}</span>
            <b className="mono">{p.n}</b>
          </span>
        ))}
      </div>
    </>
  );
}

function DeltaTable({ caption, rows }: { caption: string; rows: DeltaRow[] }) {
  return (
    <table className="dtable">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th>{caption === 'Fleet' ? 'Measure' : caption.replace('By ', '')}</th>
          <th className="num">Prior</th>
          <th className="num">Now</th>
          <th className="num">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const tone = deltaTone(r);
          const color =
            tone === 'worse'
              ? 'var(--red)'
              : tone === 'better'
                ? 'var(--green)'
                : 'var(--dim)';
          const swatch =
            caption === 'By composite tier'
              ? TIER_FILL[r.label]
              : caption === 'By HRI band'
                ? BAND_COLOR[r.label]
                : null;
          return (
            <tr key={r.label}>
              <td>
                {swatch ? (
                  <i className="swatch" style={{ background: swatch, display: 'inline-block', marginRight: 6 }} aria-hidden />
                ) : null}
                {r.label}
              </td>
              <td className="num mono">{r.prev ?? '—'}</td>
              <td className="num mono">{r.cur ?? '—'}</td>
              <td className="num mono" style={{ color }}>
                {fmtDelta(r.delta)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Exported so the Trends legend can reuse the same tier look. */
export function tierSwatch(t: Tier): string {
  return TIER_FILL[t] ?? tierLook(t).color;
}

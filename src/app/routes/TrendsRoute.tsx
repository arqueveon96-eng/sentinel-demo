/* ============================================================
   TrendsRoute.tsx — week over week across every committed run.

   This is the view that carries the product's central claim: that a
   hardware signal the experience score cannot see gets found earlier
   and closed sooner. So it is held to the strictest version of the
   house rules:

   - One scale per chart. Avg DEX (0-100, higher better) and avg CRS
     (0-100, higher worse) never share an axis.
   - Every axis labelled with its unit; the newest week emphasised.
   - Every chart has a table beside it, in a <details>.
   - Nothing is drawn that was not recorded. One committed week gets a
     single point and a sentence explaining why there is no line. A
     week whose stored record does not hold a figure is a gap, never a
     zero.
   - No entrance animation under prefers-reduced-motion.

   Validation sits at the bottom because it is the honest ceiling on
   everything above it: until twenty outcomes are graded, the bands
   these charts are drawn against are provisional and say so.
   ============================================================ */

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { validationMetrics, tuningProposal, VALIDATION_MIN } from '@/core/validation';
import { allFull, hasTrend, readRunMeta, trendPoints, type TrendPoint } from '@/core/trends';
import { cfg, sentinel } from '@/store/sentinel.store';
import { useBlob, useRun } from '@/app/lib/derived';
import { C, ChartCard, OnePoint, TIER_FILL, Tip, lastPointDot, useAnim } from '@/app/components/charts';
import { FirstRun } from '@/app/components/FirstRun';

const H = 176;
const MARGIN = { top: 8, right: 14, bottom: 22, left: 6 };

export function TrendsRoute() {
  const run = useRun();
  const blob = useBlob();

  const points = useMemo(() => trendPoints(blob.runHistory, readRunMeta(blob)), [blob]);
  const ledger = useMemo(() => validationMetrics(sentinel), [blob]);
  const tuning = useMemo(() => tuningProposal(cfg, sentinel), [blob]);

  if (!run && !points.length) {
    return (
      <FirstRun
        title="Trends"
        what="avg DEX and avg composite CRS week over week, how the tiers moved, and whether hidden risk is going up or down"
      />
    );
  }

  const trend = hasTrend(points);
  const last = points[points.length - 1];
  const lastIdx = points.length - 1;
  const full = allFull(points);

  return (
    <div className="stage-page">
      <div className="lens">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Trends</h1>
          <p>
            {points.length} committed week{points.length === 1 ? '' : 's'}
            {points.length ? ` · ${points[0].week} → ${last.week}` : ''} · the newest week is the
            emphasised point on every chart
          </p>
        </div>

        {!trend ? (
          <p className="guard-line">
            One committed run is a reading, not a trend. Everything below shows the single point it
            has and says what a second week would add. No line is drawn through one point, and no
            week is invented to make one.
          </p>
        ) : null}

        {/* ---------- the two averages, one scale each ---------- */}
        <div className="lens-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <ChartCard
            title="Average DEX"
            unit="0–100 · higher is better"
            note="The figure you report. A null DEX is excluded from the average rather than counted as zero, so a week where the export lost the column reads as a gap."
            table={<PointTable points={points} keys={[['avgDEX', 'Avg DEX']]} />}
          >
            {trend ? (
              <Series
                points={points}
                dataKey="avgDEX"
                name="Avg DEX"
                color={C.teal}
                axis="DEX (0–100)"
                lastIdx={lastIdx}
                domain={[0, 100]}
              />
            ) : (
              <OnePoint
                value={last.avgDEX ?? '—'}
                unit="avg DEX"
                week={last.week}
                what="The fleet average"
                color={C.teal}
              />
            )}
          </ChartCard>

          <ChartCard
            title="Average composite CRS"
            unit="0–100 · higher is worse"
            note="Composite risk, weighted across all seven dimensions. It moves slowly: a week that shifts it by more than a point or two is usually a change in what was exported, not in the fleet."
            table={<PointTable points={points} keys={[['avgCRS', 'Avg CRS']]} />}
          >
            {trend ? (
              <Series
                points={points}
                dataKey="avgCRS"
                name="Avg CRS"
                color={C.amber}
                axis="CRS (0–100)"
                lastIdx={lastIdx}
                domain={[0, 'auto']}
              />
            ) : (
              <OnePoint
                value={last.avgCRS}
                unit="avg CRS"
                week={last.week}
                what="The fleet average"
                color={C.amber}
              />
            )}
          </ChartCard>
        </div>

        {/* ---------- tier movement ---------- */}
        <ChartCard
          title="Tier movement"
          unit="devices per composite tier, per week"
          note={
            full
              ? 'Every bar is the whole in-scope fleet. What improved is the CRITICAL and HIGH bands shrinking while the total holds.'
              : 'Weeks committed before the console recorded a full composition show CRITICAL, HIGH and an exact remainder — the ELEVATED / MONITOR / HEALTHY split for those weeks was never stored, so it is not drawn.'
          }
          table={
            <PointTable
              points={points}
              keys={
                full
                  ? [
                      ['critical', 'CRITICAL'],
                      ['high', 'HIGH'],
                      ['elevated', 'ELEVATED'],
                      ['monitor', 'MONITOR'],
                      ['healthy', 'HEALTHY'],
                      ['devices', 'In scope'],
                    ]
                  : [
                      ['critical', 'CRITICAL'],
                      ['high', 'HIGH'],
                      ['rest', 'Rest of fleet'],
                      ['devices', 'In scope'],
                    ]
              }
            />
          }
        >
          <TierBars points={points} full={full} />
        </ChartCard>

        {/* ---------- hidden risk ---------- */}
        <ChartCard
          title="Hidden risk over time"
          unit="devices where HRI flags and the composite does not"
          note="The number nothing else in the stack produces. It going down while the queue stays the same size is the outcome this console exists for."
          table={
            <PointTable
              points={points}
              keys={[
                ['hidden', 'Hidden risk'],
                ['hriWatch', 'HRI watchlist'],
              ]}
            />
          }
        >
          {trend ? <HiddenArea points={points} lastIdx={lastIdx} /> : (
            <OnePoint
              value={last.hidden}
              unit="devices"
              week={last.week}
              what="Hidden risk"
              color={C.purple}
            />
          )}
        </ChartCard>

        {/* ---------- validation ---------- */}
        <section className="card" aria-label="Validation">
          <div className="card-head">
            <h2 className="card-title">Validation</h2>
            <span className="mono card-sub">
              {ledger.graded} / {VALIDATION_MIN} graded outcomes
            </span>
          </div>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <Metric label="Precision" value={ledger.precision} unit="%" tone="var(--teal)" />
            <Metric label="Recall" value={ledger.recall} unit="%" tone="var(--teal)" />
            <Metric label="Avg lead time" value={ledger.avgLead} unit=" days" tone="var(--green)" />
            <Metric label="Confirmed / missed" value={`${ledger.tp} / ${ledger.fn}`} tone="var(--dim-hi)" />
            <Metric label="False positives" value={ledger.fp} tone="var(--amber)" />
            <Metric
              label="Outcomes recorded"
              value={`${ledger.graded} / ${VALIDATION_MIN}`}
              tone={ledger.credible ? 'var(--green)' : 'var(--amber)'}
            />
          </div>
          <div className="compbar" role="img" aria-label={`${ledger.graded} of ${VALIDATION_MIN} outcomes graded`} style={{ height: 8 }}>
            <span
              style={{
                width: `${Math.min(100, (100 * ledger.graded) / VALIDATION_MIN)}%`,
                background: ledger.credible ? C.green : C.teal,
              }}
            />
          </div>

          <div
            style={{
              padding: '11px 13px',
              borderRadius: 8,
              background: 'var(--panel-3)',
              border: '1px solid var(--line-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}
          >
            <p className="mono eyebrow" style={{ margin: 0 }}>
              TUNING PROPOSAL · {tuning.status.toUpperCase()}
            </p>
            {tuning.status === 'insufficient' ? (
              <p className="card-note" style={{ color: 'var(--body)' }}>
                {tuning.msg} Nothing is proposed and nothing is changed — a band tuned against five
                outcomes is a guess wearing a number.
              </p>
            ) : tuning.status === 'stable' ? (
              <p className="card-note" style={{ color: 'var(--body)' }}>
                {tuning.msg}
              </p>
            ) : (
              <>
                {(tuning.props ?? []).map((p) => (
                  <div key={p.change} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <b className="mono" style={{ fontSize: 12, color: 'var(--amber)' }}>
                      {p.change}
                    </b>
                    <span style={{ fontSize: 11.5, color: 'var(--body)' }}>{p.why}</span>
                  </div>
                ))}
                <p className="card-note">
                  <b style={{ color: 'var(--amber)' }}>Proposed — never auto-applied.</b>{' '}
                  {tuning.guard?.allowed
                    ? 'The 60-day guard is clear, so this can be applied by hand in Config.'
                    : `The 60-day guard has ${tuning.guard?.daysLeft} day(s) left; a second change inside one cycle makes the previous one unmeasurable.`}
                </p>
              </>
            )}
          </div>
          <p className="card-note">
            Precision and recall are computed from graded outcomes only. Lead time is what the
            operator recorded, in days, and is never inferred.
          </p>
        </section>
      </div>
    </div>
  );
}

/* ---------- charts ---------- */

function Series({
  points,
  dataKey,
  name,
  color,
  axis,
  lastIdx,
  domain,
}: {
  points: TrendPoint[];
  dataKey: 'avgDEX' | 'avgCRS';
  name: string;
  color: string;
  axis: string;
  lastIdx: number;
  domain: [number, number | 'auto'];
}) {
  const anim = useAnim();
  return (
    <ResponsiveContainer width="100%" height={H} className="chart">
      <LineChart data={points} margin={MARGIN}>
        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="week" tickMargin={6} interval="preserveStartEnd" minTickGap={20}>
          <Label value="week ending" position="insideBottom" offset={-14} className="axis-title" />
        </XAxis>
        <YAxis domain={domain} width={44} tickMargin={4}>
          <Label value={axis} angle={-90} position="insideLeft" className="axis-title" style={{ textAnchor: 'middle' }} />
        </YAxis>
        <Tooltip content={<Tip />} cursor={{ stroke: C.line }} />
        <Line
          type="linear"
          dataKey={dataKey}
          name={name}
          stroke={color}
          strokeWidth={2}
          connectNulls={false}
          isAnimationActive={anim}
          animationDuration={280}
          dot={lastPointDot(color, lastIdx)}
          activeDot={{ r: 5, fill: color, stroke: C.panel3, strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TierBars({ points, full }: { points: TrendPoint[]; full: boolean }) {
  const anim = useAnim();
  const stack: { key: keyof TrendPoint; label: string; fill: string }[] = full
    ? [
        { key: 'critical', label: 'CRITICAL', fill: TIER_FILL.CRITICAL },
        { key: 'high', label: 'HIGH', fill: TIER_FILL.HIGH },
        { key: 'elevated', label: 'ELEVATED', fill: TIER_FILL.ELEVATED },
        { key: 'monitor', label: 'MONITOR', fill: TIER_FILL.MONITOR },
        { key: 'healthy', label: 'HEALTHY', fill: TIER_FILL.HEALTHY },
      ]
    : [
        { key: 'critical', label: 'CRITICAL', fill: TIER_FILL.CRITICAL },
        { key: 'high', label: 'HIGH', fill: TIER_FILL.HIGH },
        { key: 'rest', label: 'Rest of fleet', fill: TIER_FILL.REST },
      ];
  return (
    <>
      <ResponsiveContainer width="100%" height={H + 24} className="chart">
        <BarChart data={points} margin={MARGIN}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="week" tickMargin={6} interval="preserveStartEnd" minTickGap={20}>
            <Label value="week ending" position="insideBottom" offset={-14} className="axis-title" />
          </XAxis>
          <YAxis width={44} tickMargin={4}>
            <Label value="devices" angle={-90} position="insideLeft" className="axis-title" style={{ textAnchor: 'middle' }} />
          </YAxis>
          <Tooltip content={<Tip unit="devices" />} cursor={{ fill: 'rgb(45 212 191 / 0.06)' }} />
          {stack.map((s, i) => (
            <Bar
              key={s.key as string}
              dataKey={s.key as string}
              name={s.label}
              stackId="tiers"
              fill={s.fill}
              isAnimationActive={anim}
              animationDuration={280}
              maxBarSize={54}
              radius={i === stack.length - 1 ? [3, 3, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="complegend">
        {stack.map((s) => (
          <span key={s.key as string}>
            <i className="swatch" style={{ background: s.fill }} aria-hidden />
            <span style={{ color: 'var(--dim)' }}>{s.label}</span>
          </span>
        ))}
      </div>
    </>
  );
}

function HiddenArea({ points, lastIdx }: { points: TrendPoint[]; lastIdx: number }) {
  const anim = useAnim();
  return (
    <ResponsiveContainer width="100%" height={H} className="chart">
      <AreaChart data={points} margin={MARGIN}>
        <defs>
          <linearGradient id="hiddenFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.purple} stopOpacity={0.34} />
            <stop offset="100%" stopColor={C.purple} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="week" tickMargin={6} interval="preserveStartEnd" minTickGap={20}>
          <Label value="week ending" position="insideBottom" offset={-14} className="axis-title" />
        </XAxis>
        <YAxis width={44} tickMargin={4} allowDecimals={false}>
          <Label value="devices" angle={-90} position="insideLeft" className="axis-title" style={{ textAnchor: 'middle' }} />
        </YAxis>
        <Tooltip content={<Tip unit="devices" />} cursor={{ stroke: C.line }} />
        <Area
          type="linear"
          dataKey="hidden"
          name="Hidden risk"
          stroke={C.purple}
          strokeWidth={2}
          fill="url(#hiddenFill)"
          connectNulls={false}
          isAnimationActive={anim}
          animationDuration={280}
          dot={lastPointDot(C.purple, lastIdx)}
          activeDot={{ r: 5, fill: C.purple, stroke: C.panel3, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ---------- the table every chart carries ---------- */

function PointTable({
  points,
  keys,
}: {
  points: TrendPoint[];
  keys: [keyof TrendPoint, string][];
}) {
  return (
    <table className="dtable mono">
      <caption>One row per committed week, oldest first</caption>
      <thead>
        <tr>
          <th>Week ending</th>
          {keys.map(([, label]) => (
            <th key={label} className="num">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.week + p.committedAt}>
            <td>{p.week}</td>
            {keys.map(([k, label]) => {
              const v = p[k];
              return (
                <td key={label} className="num" style={v == null ? { color: 'var(--dim)' } : undefined}>
                  {v == null ? 'not recorded' : String(v)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Metric({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  tone: string;
}) {
  const shown = value == null ? '—' : `${value}${unit ?? ''}`;
  return (
    <div className="kpi" style={{ borderTopColor: value == null ? 'var(--line)' : tone }}>
      <span className="mono kpi-value" style={{ color: value == null ? 'var(--dim)' : tone }}>
        {shown}
      </span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

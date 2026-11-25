/* ============================================================
   charts.tsx — the chart primitives Trends is built from.

   Rules this file exists to enforce, in one place:

   - ONE SCALE PER CHART. Avg DEX and avg CRS are different units on
     opposite polarities and never share an axis.
   - Every axis is labelled, with its unit.
   - THE LAST POINT IS THE EMPHASISED ONE. It is the week you just
     committed; everything else is context for it.
   - Chart text and grid lines come from the tokens (see the `.chart`
     rules in console.css); series colours are literal hex, because a
     CSS `var()` is not valid in an SVG presentation attribute. Every
     hex below is a value that already exists in tokens.css — nothing
     is invented here.
   - Every chart has a table alternative, in a <details> beside it.
   - No entrance animation under prefers-reduced-motion.
   - NEVER A FABRICATED POINT. A week with no recorded figure is a gap
     in the line (`connectNulls={false}`), not a zero.
   ============================================================ */

import { useReducedMotion } from 'motion/react';

/** Literal hex, each one a token value from tokens.css. */
export const C = {
  teal: '#2dd4bf', // --teal
  tealL: '#5eead4', // --teal-l
  red: '#f85149', // --red
  amber: '#f0a020', // --amber
  purple: '#bc8cff', // --purple
  green: '#3fb950', // --green
  dim: '#8b949e', // --dim
  line: '#2b333d', // --line
  panel3: '#06080d', // --panel-3
} as const;

/** The five composite tiers, worst first — the same colours the pills use. */
export const TIER_FILL: Record<string, string> = {
  CRITICAL: C.red,
  HIGH: C.amber,
  ELEVATED: '#8a6d1f', // a darker --amber, so ELEVATED reads apart from HIGH in a stack
  MONITOR: '#0f766e', // --teal-d
  HEALTHY: '#39424d', // a lift of --line, for "nothing to say"
  REST: '#39424d',
};

export function useAnim(): boolean {
  return !useReducedMotion();
}

/* ---------- text on a filled band ---------- */

function relLum(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * A count printed inside a coloured band has to clear 4.5:1 against THAT
 * band, not against the page. Picking the better of the two ink colours
 * the token set already has is deterministic and beats hand-assigning
 * one per band and getting it wrong when a colour changes: with the
 * current fills the worst case is ELEVATED at 4.71:1.
 */
export function onFill(fill: string): string {
  const dark = C.panel3; // #06080d
  const light = '#eafffb'; // --on-teal-d
  return contrast(fill, dark) >= contrast(fill, light) ? dark : light;
}

/**
 * A chart and its table, in one card. The table is not a fallback — it
 * is the accessible reading of the same numbers, and it is always there.
 */
export function ChartCard({
  title,
  unit,
  note,
  children,
  table,
}: {
  title: string;
  /** the unit, said out loud once, next to the title */
  unit: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  table: React.ReactNode;
}) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-head">
        <h3 className="card-title">{title}</h3>
        <span className="mono card-sub">{unit}</span>
      </div>
      {children}
      {note ? <p className="card-note">{note}</p> : null}
      <details className="astable">
        <summary>{title} as a table</summary>
        <div className="table-scroll">{table}</div>
      </details>
    </section>
  );
}

/** The tooltip. One value, its unit, and the week it belongs to. */
export function Tip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string | null; color?: string; dataKey?: string }[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="mono" style={{ color: 'var(--dim)', fontSize: 10.5 }}>
        week ending {String(label)}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="swatch" style={{ background: p.color }} aria-hidden />
          {p.name}: <b className="mono">{p.value == null ? 'not recorded' : p.value}</b>
          {unit ? <span style={{ color: 'var(--dim)' }}>{unit}</span> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The dot renderer that emphasises the newest week. Recharts hands each
 * point its index; the last one gets a filled ring, the rest a small dot,
 * and a week with no value gets nothing at all.
 */
export function lastPointDot(color: string, lastIndex: number) {
  // Recharts keys each dot itself (component/Dots.js), so no key here.
  return function renderDot(props: { cx?: number; cy?: number; index?: number; value?: unknown }) {
    const { cx, cy, index, value } = props;
    if (cx == null || cy == null || value == null) return <g />;
    const isLast = index === lastIndex;
    return (
      <g>
        {isLast ? (
          <circle cx={cx} cy={cy} r={7} fill={color} fillOpacity={0.18} stroke="none" />
        ) : null}
        <circle
          cx={cx}
          cy={cy}
          r={isLast ? 4 : 2.5}
          fill={isLast ? color : C.panel3}
          stroke={color}
          strokeWidth={isLast ? 2 : 1.5}
        />
      </g>
    );
  };
}

/** One committed week and nothing to join it to — said plainly. */
export function OnePoint({
  value,
  unit,
  week,
  what,
  color,
}: {
  value: string | number;
  unit: string;
  week: string;
  what: string;
  color: string;
}) {
  return (
    <div className="onepoint">
      <span className="mono onepoint-value" style={{ color }}>
        {value}
        <span style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 500 }}> {unit}</span>
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.55 }}>
        {what} for the week ending <span className="mono">{week}</span>. A trend needs two committed
        weeks — commit next week's export and this becomes a line.
      </span>
    </div>
  );
}

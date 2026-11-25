/* ============================================================
   Glyph.tsx — the severity marks, inline SVG exactly as the mockups
   draw them. Triangle = failing / critical, diamond = degrading /
   high, circle = hidden risk / watch, dash = nothing flagged.

   These carry meaning, so they are never the only carrier: every
   place a glyph appears the label appears with it, and the glyph
   itself takes a `title` when it stands alone in a row.
   ============================================================ */

import type { Mark } from '@/app/lib/severity';

export function Glyph({
  mark,
  color,
  size = 10,
  label,
}: {
  mark: Mark;
  color: string;
  size?: number;
  /** an accessible name; omit when adjacent text already says it */
  label?: string;
}) {
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      style={{ color, display: 'block', flex: 'none' }}
      {...a11y}
    >
      {mark === 'triangle' ? <path d="M5 1l4.5 8h-9z" fill="currentColor" /> : null}
      {mark === 'diamond' ? <path d="M5 0.5l4.5 4.5-4.5 4.5L0.5 5z" fill="currentColor" /> : null}
      {mark === 'circle' ? <circle cx="5" cy="5" r="4" fill="currentColor" /> : null}
      {mark === 'dash' ? <rect x="1" y="4.2" width="8" height="1.6" fill="currentColor" /> : null}
    </svg>
  );
}

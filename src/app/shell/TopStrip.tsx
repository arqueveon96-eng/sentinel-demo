/* ============================================================
   TopStrip.tsx — identity, the week, and the quiet utility corner.
   Fleet / Trends / Reports / Config / Export are lenses, not stages:
   they sit here precisely so they cannot be mistaken for the weekly
   sequence.

   Export is a link like the others so it can be opened cold or in a new
   tab; the shell turns `/export` into a sheet, because a backup is a
   thing you do to the store rather than a place in the week.
   ============================================================ */

import { NavLink } from 'react-router-dom';
import { Keyboard } from 'lucide-react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `2026-09-03` → `Thursday`. Parsed as a plain date, never a timezone shift. */
export function weekdayOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return DAYS[d.getUTCDay()];
}

export function TopStrip({
  weekEnding,
  onShortcuts,
}: {
  weekEnding: string | null;
  onShortcuts?: () => void;
}) {
  const day = weekdayOf(weekEnding);
  return (
    <header className="topstrip">
      <div className="brand">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
          <path d="M8 1.5l5.5 2v4c0 3.2-2.3 5.6-5.5 7-3.2-1.4-5.5-3.8-5.5-7v-4z" />
        </svg>
        <span className="brand-name">Sentinel</span>
        <span className="brand-sub">Demo fleet · synthetic data</span>
      </div>
      <span className="mono week">
        {weekEnding ? `Week ending ${weekEnding}${day ? ` · ${day}` : ''}` : 'No run committed'}
      </span>
      <nav className="util" aria-label="Lenses">
        <NavLink to="/fleet">Fleet</NavLink>
        <NavLink to="/trends">Trends</NavLink>
        <NavLink to="/reports">Reports</NavLink>
        <NavLink to="/config">Config</NavLink>
        <NavLink to="/export">Export</NavLink>
      </nav>
      {onShortcuts ? (
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          onClick={onShortcuts}
          title="Keyboard shortcuts — press ?"
          aria-label="Keyboard shortcuts"
          style={{ padding: '4px 8px' }}
        >
          <Keyboard size={13} aria-hidden />
          <span className="mono" aria-hidden>
            ?
          </span>
        </button>
      ) : null}
    </header>
  );
}

export function Guardrails() {
  return (
    <footer className="guardrails">
      <span>Deterministic — no AI in the scoring path.</span>
      <span>Baseline never silently overwritten.</span>
      <span>Percentile rank is never absolute risk.</span>
      <span>Never a fabricated number.</span>
    </footer>
  );
}

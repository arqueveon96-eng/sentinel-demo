/* ============================================================
   StageRail.tsx — the only primary navigation.

   Five real <button>s in a horizontal group. Each says where it sits in
   the week, what it is for, and one line of live status. The rail
   suggests the sequence; nothing is locked.

   Motion #2 (second half): when a stage flips from NOW to done, its
   check draws in. That only fires on a transition seen by this mount —
   a page that loads with four stages already done draws nothing.
   ============================================================ */

import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import type { Stage, StageId } from '@/app/lib/stages';
import { SlidingNumber } from '@/app/components/bits';

function CheckDot({ draw }: { draw: boolean }) {
  const reduce = useReducedMotion();
  return (
    <span className="rail-dot" aria-hidden>
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <motion.path
          d="M3 8.5l3 3 7-7"
          initial={draw && !reduce ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.28, ease: [0, 0, 0.2, 1] }}
        />
      </svg>
    </span>
  );
}

/** Splits `3 of 34 findings recorded` so the leading count can slide. */
function RailLine({ stage }: { stage: Stage }) {
  const counted =
    stage.id === 'investigate' || stage.id === 'close'
      ? stage.line.match(/^(\d+) of (\d+) (.*)$/)
      : null;
  if (!counted) return <span className="rail-line">{stage.line}</span>;
  return (
    <span className="rail-line">
      <SlidingNumber value={Number(counted[1])} className="mono" /> of{' '}
      <span className="mono">{counted[2]}</span> {counted[3]}
    </span>
  );
}

export function StageRail({ stages, current }: { stages: Stage[]; current: StageId }) {
  // remember which stages were NOW last render, so only a real completion draws
  const wasNow = useRef<Set<StageId>>(new Set());
  const justDone = new Set<StageId>();
  stages.forEach((s) => {
    if (s.status === 'done' && wasNow.current.has(s.id)) justDone.add(s.id);
  });
  useEffect(() => {
    wasNow.current = new Set(stages.filter((s) => s.status === 'now').map((s) => s.id));
  });

  return (
    <nav className="rail" aria-label="Weekly stages">
      <div className="rail-grid">
        {stages.map((s) => {
          const cls =
            s.status === 'now' ? 'is-now' : s.status === 'done' ? 'is-done' : 'is-upcoming';
          return (
            <NavLink
              key={s.id}
              to={`/${s.id}`}
              className={`rail-card ${cls}`}
              aria-current="step"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <span className="rail-top">
                {s.status === 'done' ? (
                  <CheckDot draw={justDone.has(s.id)} />
                ) : (
                  <span className="rail-dot" aria-hidden>
                    {s.n}
                  </span>
                )}
                <span className="mono rail-days">{s.days}</span>
                <span className="rail-label">{s.label}</span>
                <span className="sr-only">
                  {s.status === 'done'
                    ? '— done'
                    : s.status === 'now'
                      ? '— now, the next stage with work left'
                      : '— not started'}
                  {current === s.id ? ', currently open' : ''}
                </span>
                {s.status === 'now' ? (
                  <span className="mono rail-now" aria-hidden>
                    NOW
                  </span>
                ) : null}
              </span>
              <RailLine stage={s} />
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

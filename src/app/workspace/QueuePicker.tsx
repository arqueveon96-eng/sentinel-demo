/* ============================================================
   QueuePicker.tsx — how you choose the next machine.

   A real listbox: arrow keys, Home/End, aria-activedescendant, one
   aria-selected option, groups labelled with the rank's own reason.
   `/` focuses the filter from anywhere in the workspace.

   Motion #1 (second half): the selection rule slides between rows with
   a layout animation, so the frame tells you what just moved.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { CornerDownLeft } from 'lucide-react';
import type { QueueRow } from '@/core/types';
import { reasonLook, stateColor } from '@/app/lib/severity';
import { Glyph } from '@/app/components/Glyph';
import { CopyButton } from '@/app/components/bits';
import { fmt } from '@/core/format';
import type { StageId } from '@/app/lib/stages';

export interface Group {
  label: string;
  rows: QueueRow[];
}

/** Consecutive rows sharing a dispatch reason, in the order the core sorted them. */
export function groupQueue(rows: QueueRow[]): Group[] {
  const out: Group[] = [];
  rows.forEach((r) => {
    const label = r.reason.label;
    const last = out[out.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else out.push({ label, rows: [r] });
  });
  return out;
}

export function filterQueue(rows: QueueRow[], q: string): QueueRow[] {
  const t = q.trim().toLowerCase();
  if (!t) return rows;
  return rows.filter((r) =>
    [r.name, r.user, r.model, r.reason.label, r.state, r.assignee, r.ticketId]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(t)),
  );
}

const optionId = (name: string) => `q-${name.replace(/[^\w-]/g, '_')}`;

export function QueuePicker({
  rows,
  all,
  selected,
  stage,
  filter,
  onFilter,
  onSelect,
  packageText,
  onPackaged,
  onFindingsIn,
  filterRef,
}: {
  /** the filtered rows shown */
  rows: QueueRow[];
  /** the unfiltered queue, for the header count */
  all: QueueRow[];
  selected: string | null;
  stage: StageId;
  filter: string;
  onFilter: (v: string) => void;
  onSelect: (name: string, direction: 1 | -1) => void;
  packageText: () => string;
  onPackaged: () => void;
  /** opens the bulk findings-in sheet — the other half of the assistant handoff */
  onFindingsIn: () => void;
  filterRef: React.RefObject<HTMLInputElement | null>;
}) {
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupQueue(rows), [rows]);
  const index = rows.findIndex((r) => r.name === selected);

  // keep the selected row in view when it changes from outside (J/K, next machine)
  useEffect(() => {
    if (!selected) return;
    const el = listRef.current?.querySelector(`#${CSS.escape(optionId(selected))}`);
    // jsdom has no scrollIntoView; the guard keeps the test environment honest
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function')
      (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [selected]);

  function move(delta: number) {
    if (!rows.length) return;
    const next = index < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, index + delta));
    onSelect(rows[next].name, delta >= 0 ? 1 : -1);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        if (rows.length) onSelect(rows[0].name, -1);
        break;
      case 'End':
        e.preventDefault();
        if (rows.length) onSelect(rows[rows.length - 1].name, 1);
        break;
      default:
        break;
    }
  }

  return (
    <div className="picker">
      <div className="picker-head">
        <span className="picker-title">
          <b>Queue</b>
          <span className="mono">
            {all.length} · dispatch order
            {rows.length !== all.length ? ` · ${rows.length} shown` : ''}
          </span>
        </span>
        <input
          ref={filterRef}
          className="picker-filter mono"
          type="search"
          value={filter}
          placeholder="Filter — press /"
          aria-label="Filter the queue"
          onChange={(e) => onFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onFilter('');
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      <div
        ref={listRef}
        className="picker-list"
        role="listbox"
        tabIndex={0}
        aria-label="Queue in dispatch order"
        aria-activedescendant={selected ? optionId(selected) : undefined}
        onKeyDown={onKeyDown}
      >
        {groups.length === 0 ? (
          <p className="picker-empty">
            {all.length ? 'Nothing matches that filter.' : 'Nothing is queued from this run.'}
          </p>
        ) : null}
        {groups.map((g) => {
          const look = reasonLook(g.label);
          return (
            <div key={g.label + g.rows[0].name} role="group" aria-label={`${g.label}, ${g.rows.length}`}>
              <div className="mono group-head" style={{ color: look.color }} aria-hidden>
                {g.label} · {g.rows.length}
              </div>
              {g.rows.map((r) => {
                const isSel = r.name === selected;
                const sub =
                  stage === 'investigate'
                    ? [r.user || '—', r.model || '—'].join(' · ')
                    : r.state === 'NEW'
                      ? [r.user || '—', r.model || '—'].join(' · ')
                      : r.ticketId
                        ? `${r.state.replace('_', ' ')} · ${r.ticketId}`
                        : r.state.replace('_', ' ');
                const subColor =
                  stage !== 'investigate' && r.state !== 'NEW' ? stateColor(r.state) : undefined;
                return (
                  <button
                    key={r.name}
                    id={optionId(r.name)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSel}
                    className={`qrow${isSel ? ' is-sel' : ''}`}
                    onClick={() => onSelect(r.name, 1)}
                  >
                    {isSel ? (
                      <motion.span
                        className="qrow-mark"
                        layoutId={reduce ? undefined : 'picker-mark'}
                        transition={{ duration: reduce ? 0 : 0.2, ease: [0.4, 0, 0.2, 1] }}
                        aria-hidden
                      />
                    ) : null}
                    <Glyph mark={look.mark} color={look.color} label={g.label} />
                    <span style={{ minWidth: 0 }}>
                      <span className="mono qrow-name">{r.name}</span>
                      <span className="qrow-sub" style={subColor ? { color: subColor } : undefined}>
                        {sub}
                      </span>
                    </span>
                    <span className="mono qrow-crs">{fmt(r.crs)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="picker-foot" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <CopyButton
          className="btn btn-block"
          text={packageText}
          onDone={(ok) => ok && onPackaged()}
          title="Copies the scoped investigation package for Copilot"
        >
          Package all {all.length} for the assistant
        </CopyButton>
        <button
          type="button"
          className="btn btn-sm btn-block btn-quiet"
          onClick={onFindingsIn}
          title="Paste the assistant's findings block back in, for many devices at once"
        >
          <CornerDownLeft size={12} aria-hidden />
          Findings in — the return leg
        </button>
      </div>
    </div>
  );
}

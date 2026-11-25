/* ============================================================
   WorkspaceRoute.tsx — Investigate, Work and Close are one screen.

   Picker left, dossier right, and a bottom panel that changes with the
   stage. Everything above the panel is identical across the three, on
   purpose: it should read as one dossier changing what it asks for,
   not three screens that happen to share a header.

   Motion #2 (first half): the stage panel crossfades; nothing above it
   moves when the stage changes.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { buildExportPackage } from '@/core/investigate';
import { cfg, sentinel } from '@/store/sentinel.store';
import type { ProactiveTicket } from '@/core/tickets';
import { proactiveTicket } from '@/core/tickets';
import { downloadText } from '@/lib/clipboard';
import {
  useEffectiveRow,
  useLedger,
  useOutcomeFor,
  useOverlay,
  useQueue,
  useRun,
} from '@/app/lib/derived';
import { useUi } from '@/app/lib/ui.store';
import type { StageId } from '@/app/lib/stages';
import { CopyButton, LiveRegion, useAnnouncer } from '@/app/components/bits';
import { Dossier } from '@/app/workspace/Dossier';
import { filterQueue, QueuePicker } from '@/app/workspace/QueuePicker';
import { InvestigatePanel } from '@/app/workspace/InvestigatePanel';
import { WorkPanel } from '@/app/workspace/WorkPanel';
import { ClosePanel } from '@/app/workspace/ClosePanel';
import { ProactiveTicketSheet, batchCSV } from '@/app/workspace/ProactiveTicketSheet';

export function WorkspaceRoute({ stage }: { stage: StageId }) {
  const reduce = useReducedMotion();
  const run = useRun();
  const queue = useQueue();
  const ledger = useLedger();
  const [msg, say] = useAnnouncer();
  const [sheet, setSheet] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const selected = useUi((s) => s.selected);
  const direction = useUi((s) => s.direction);
  const filter = useUi((s) => s.filter);
  const batch = useUi((s) => s.batch);
  const select = useUi((s) => s.select);
  const setFilter = useUi((s) => s.setFilter);
  const toggleBatch = useUi((s) => s.toggleBatch);
  const clearBatch = useUi((s) => s.clearBatch);
  const openSheet = useUi((s) => s.openSheet);
  const appSheet = useUi((s) => s.sheet);

  const shown = useMemo(() => filterQueue(queue, filter), [queue, filter]);

  // a toast from the previous stage must not linger over the next one
  useEffect(() => {
    say('');
  }, [stage, say]);

  // land on the top of the queue, and never sit on a device that left it
  useEffect(() => {
    if (!queue.length) return;
    if (!selected || !queue.some((q) => q.name === selected)) select(queue[0].name, 1);
  }, [queue, selected, select]);

  const row = useEffectiveRow(selected);
  const overlay = useOverlay(selected);
  const outcome = useOutcomeFor(selected);
  const qrow = useMemo(() => queue.find((q) => q.name === selected) ?? null, [queue, selected]);
  const index = shown.findIndex((q) => q.name === selected);

  const go = useCallback(
    (delta: 1 | -1) => {
      if (!shown.length) return;
      const next = index < 0 ? 0 : index + delta;
      if (next < 0 || next >= shown.length) return;
      select(shown[next].name, delta);
    },
    [shown, index, select],
  );

  /* J / K move between machines; `/` focuses the filter. Never while the
     operator is typing, and never while the sheet has focus. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (sheet || appSheet) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        go(-1);
      } else if (e.key === '/') {
        e.preventDefault();
        filterRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, sheet, appSheet]);

  const packageText = useCallback(
    () => (run ? buildExportPackage(run, cfg).text : ''),
    [run],
  );

  if (!run) {
    return (
      <div className="stage-page">
        <div className="page-head">
          <h1 className="page-title">Nothing is committed yet</h1>
          <p>The workspace needs a scored run behind it.</p>
        </div>
        <Link className="btn btn-primary" to="/pull" style={{ width: 'fit-content' }}>
          Go to Pull
        </Link>
      </div>
    );
  }

  if (!queue.length || !row) {
    return (
      <div className="stage-page">
        <div className="page-head">
          <h1 className="page-title">Nothing is queued</h1>
          <p>
            This run flagged no device for dispatch. That is a result, not an error — check the
            Score stage to see what the fleet looked like.
          </p>
        </div>
      </div>
    );
  }

  const batchPayloads: ProactiveTicket[] = batch
    .map((n) => queue.find((q) => q.name === n))
    .filter((q): q is NonNullable<typeof q> => !!q)
    .map((q) => proactiveTicket(q, cfg, sentinel));

  const panel =
    stage === 'investigate' ? (
      <InvestigatePanel
        row={row}
        overlay={overlay}
        onRecorded={() => undefined}
        onAdvance={() => go(1)}
        onPhases={() => openSheet('phases')}
        say={say}
      />
    ) : stage === 'work' ? (
      qrow ? (
        <WorkPanel
          qrow={qrow}
          onOpenSheet={() => setSheet(true)}
          onAddToBatch={() => {
            toggleBatch(qrow.name);
            say(
              batch.includes(qrow.name)
                ? `${qrow.name} removed from the batch.`
                : `${qrow.name} added to the batch.`,
            );
          }}
          inBatch={batch.includes(qrow.name)}
          say={say}
        />
      ) : null
    ) : (
      <ClosePanel
        row={row}
        qrow={qrow}
        run={run}
        existing={outcome}
        onRecorded={() => undefined}
        onAdvance={() => go(1)}
        onRoundup={() => openSheet('roundup')}
        say={say}
      />
    );

  return (
    <>
      <div className="workspace">
        <QueuePicker
          rows={shown}
          all={queue}
          selected={selected}
          stage={stage}
          filter={filter}
          onFilter={setFilter}
          onSelect={select}
          packageText={packageText}
          onPackaged={() => {
            sentinel.logHandoff('out', 'copilot', `scoped package (${queue.length} devices)`, queue.length);
            say(`Package for ${queue.length} devices copied.`);
          }}
          onFindingsIn={() => openSheet('findings')}
          filterRef={filterRef}
        />
        <Dossier
          row={row}
          qrow={qrow}
          run={run}
          outcome={outcome}
          graded={ledger.graded}
          direction={direction}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          hasPrev={index > 0}
          hasNext={index >= 0 && index < shown.length - 1}
          panel={
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={stage}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.16 }}
              >
                {panel}
              </motion.div>
            </AnimatePresence>
          }
        />
      </div>

      {stage === 'work' && batch.length ? (
        <div className="batchbar">
          <span>
            Ticket batch: <b className="mono" style={{ color: 'var(--txt)' }}>{batch.length}</b>{' '}
            device{batch.length === 1 ? '' : 's'} —{' '}
            <span className="mono">{batch.slice(0, 6).join(' ')}</span>
            {batch.length > 6 ? ` +${batch.length - 6}` : ''}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <CopyButton
              className="btn btn-sm"
              text={() => batchCSV(batchPayloads)}
              onDone={(ok) => say(ok ? 'Batch CSV copied.' : 'Copy blocked by the browser.')}
            >
              Copy CSV
            </CopyButton>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                downloadText(`proactive-tickets-${run.weekEnding}.csv`, batchCSV(batchPayloads));
                say('Batch CSV downloaded.');
              }}
            >
              <Download size={12} aria-hidden />
              Download
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={clearBatch}>
              Clear
            </button>
          </span>
        </div>
      ) : null}

      {sheet && qrow ? (
        <ProactiveTicketSheet
          qrow={qrow}
          onClose={() => setSheet(false)}
          onAddToBatch={() => {
            if (!batch.includes(qrow.name)) toggleBatch(qrow.name);
          }}
          say={say}
        />
      ) : null}

      <LiveRegion message={msg} />
    </>
  );
}

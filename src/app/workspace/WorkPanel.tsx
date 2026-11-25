/* ============================================================
   WorkPanel.tsx — Stage 4 asks for a decision and a ticket.

   State goes through the core's state machine (setDeviceState), which
   journals every transition to the changelog and carries the device
   forward week to week. Assignee, ticket id and note go through
   setQueueField, same journal.
   ============================================================ */

import { useEffect, useState } from 'react';
import { FileText, Layers } from 'lucide-react';
import type { QueueRow } from '@/core/types';
import { sentinel, cfg } from '@/store/sentinel.store';
import { proactiveTicket, proactiveProductWhy } from '@/core/tickets';
import { stateColor } from '@/app/lib/severity';
import { PanelShell } from './PanelShell';

const FLOW = ['NEW', 'TRIAGED', 'ACTIONED', 'RESOLVED'] as const;
const ASIDE = ['DEFERRED', 'FALSE_POSITIVE'] as const;

export function WorkPanel({
  qrow,
  onOpenSheet,
  onAddToBatch,
  inBatch,
  say,
}: {
  qrow: QueueRow;
  onOpenSheet: () => void;
  onAddToBatch: () => void;
  inBatch: boolean;
  say: (m: string) => void;
}) {
  const [assignee, setAssignee] = useState(qrow.assignee || '');
  const [ticket, setTicket] = useState(qrow.ticketId || '');
  const [note, setNote] = useState(() => sentinel.getWork(qrow.name).note || '');

  useEffect(() => {
    setAssignee(qrow.assignee || '');
    setTicket(qrow.ticketId || '');
    setNote(sentinel.getWork(qrow.name).note || '');
  }, [qrow.name, qrow.assignee, qrow.ticketId]);

  function setState(next: string) {
    sentinel.setDeviceState(qrow.name, next, 'work');
    say(`${qrow.name} set to ${next.replace('_', ' ')}.`);
  }

  function commitField(field: 'assignee' | 'ticketId', value: string) {
    sentinel.setQueueField(qrow.name, field, value, 'work');
  }

  const draft = proactiveTicket(qrow, cfg, sentinel);

  return (
    <PanelShell
      stage="STAGE 4 · WORK"
      ask="This stage asks for one thing: a decision, and the ticket that carries it."
      hint="Sentinel drafts. You submit. It never touches the ticketing system itself."
      cols="1.15fr 1fr"
      foot={
        <>
          <span>Same machine, later this week:</span>
          <span className="mono chip">CLOSE · record the outcome</span>
          <span style={{ marginLeft: 'auto' }}>
            Every state change is journalled to this week&apos;s changelog.
          </span>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend style={{ fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: 6 }}>
            State for <span className="mono">{qrow.name}</span>
          </legend>
          <div className="segment" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            {FLOW.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={qrow.state === s}
                onClick={() => setState(s)}
                style={
                  qrow.state === s
                    ? {
                        color: stateColor(s),
                        borderColor: stateColor(s),
                        background: `color-mix(in srgb, ${stateColor(s)} 16%, transparent)`,
                      }
                    : undefined
                }
              >
                {s}
              </button>
            ))}
          </div>
          <div
            className="segment"
            style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 6 }}
          >
            {ASIDE.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={qrow.state === s}
                onClick={() => setState(s)}
                style={
                  qrow.state === s
                    ? {
                        color: stateColor(s),
                        borderColor: stateColor(s),
                        background: `color-mix(in srgb, ${stateColor(s)} 16%, transparent)`,
                      }
                    : undefined
                }
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </fieldset>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="field">
            <label className="field-label" htmlFor="assignee">
              Assignee
            </label>
            <input
              id="assignee"
              className="mono input"
              value={assignee}
              placeholder="owner ID"
              onChange={(e) => setAssignee(e.target.value)}
              onBlur={() => commitField('assignee', assignee)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ticket">
              Ticket #
            </label>
            <input
              id="ticket"
              className="mono input"
              value={ticket}
              placeholder="INC…"
              onChange={(e) => setTicket(e.target.value)}
              onBlur={() => commitField('ticketId', ticket)}
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="worknote">
            Note
          </label>
          <textarea
            id="worknote"
            className="mono textarea"
            rows={2}
            value={note}
            placeholder="What you did, in one line."
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => sentinel.setWork(qrow.name, sentinel.getWork(qrow.name).state, note)}
          />
        </div>

        {qrow.escalate ? (
          <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: 0 }}>
            {qrow.weeks} consecutive weeks in the queue — this one has earned an escalation.
          </p>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 14px',
          borderRadius: 8,
          background: 'var(--panel-3)',
          border: '1px solid var(--line-2)',
          minWidth: 0,
        }}
      >
        <p className="mono eyebrow" style={{ margin: 0 }}>
          WHAT THE DRAFT WILL SAY
        </p>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '4px 10px', fontSize: 12 }}>
          <dt style={{ color: 'var(--dim)' }}>Device</dt>
          <dd style={{ margin: 0 }}>
            {draft.product || <span style={{ color: 'var(--amber)' }}>pick manually</span>}{' '}
            <span style={{ color: 'var(--dim)', fontSize: 11 }}>· {proactiveProductWhy(qrow)}</span>
          </dd>
          <dt style={{ color: 'var(--dim)' }}>Issue</dt>
          <dd style={{ margin: 0 }}>{draft.category}</dd>
          <dt style={{ color: 'var(--dim)' }}>Remediation</dt>
          <dd style={{ margin: 0 }}>{draft.remediation}</dd>
        </dl>
        <p style={{ fontSize: 11.5, color: 'var(--body)', margin: 0, lineHeight: 1.5 }}>
          {draft.summary}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={onOpenSheet}>
            <FileText size={12} aria-hidden />
            Draft Proactive Ticket
          </button>
          <button
            type="button"
            className="btn"
            onClick={onAddToBatch}
            aria-pressed={inBatch}
            title="Adds this device to the bulk ticket CSV"
          >
            <Layers size={12} aria-hidden />
            {inBatch ? 'In batch' : 'Add to batch'}
          </button>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--dim)', margin: 0 }}>
          Owner name is left for you — the export carries an owner ID only.
        </p>
      </div>
    </PanelShell>
  );
}

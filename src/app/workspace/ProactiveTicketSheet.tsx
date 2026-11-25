/* ============================================================
   ProactiveTicketSheet.tsx — the per-device Proactive Ticket draft.

   Thirteen fields in form order, pre-filled by `proactiveTicket()`.
   Every pre-filled value is marked as a suggestion so the operator
   knows what Sentinel guessed and what they changed. Owner name stays
   empty on purpose: the export carries an owner ID only, and a name is
   not something this console will invent.

   It never submits. There is no submit. The only way out is Copy
   payload or Add to batch.

   Focus: the sheet traps Tab, closes on Escape, and returns focus to
   whatever opened it. PHASE 3: that contract moved into the shared
   <Sheet> (src/app/components/Sheet.tsx) so the five new sheets share
   it verbatim rather than each re-implementing a focus trap. Nothing
   here changed but the wrapper.
   ============================================================ */

import { useMemo, useState } from 'react';
import { PenLine, Sparkle } from 'lucide-react';
import {
  PROACTIVE_FIELDS,
  proactiveMissing,
  proactiveTicket,
  proactiveTicketText,
  proactiveProductWhy,
  ticketsCSV,
  type ProactiveTicket,
} from '@/core/tickets';
import type { QueueRow } from '@/core/types';
import { cfg, sentinel } from '@/store/sentinel.store';
import { CopyButton } from '@/app/components/bits';
import { Sheet } from '@/app/components/Sheet';

export function ProactiveTicketSheet({
  qrow,
  onClose,
  onAddToBatch,
  say,
}: {
  qrow: QueueRow;
  onClose: () => void;
  onAddToBatch: (payload: ProactiveTicket) => void;
  say: (m: string) => void;
}) {
  const suggested = useMemo(() => proactiveTicket(qrow, cfg, sentinel), [qrow]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROACTIVE_FIELDS.map((f) => [f.key, String(suggested[f.key] ?? '')])),
  );
  const payload: ProactiveTicket = { ...suggested, ...values } as ProactiveTicket;
  const missing = proactiveMissing(payload);
  const filled = PROACTIVE_FIELDS.filter((f) => f.required).length - missing.length;
  const requiredTotal = PROACTIVE_FIELDS.filter((f) => f.required).length;

  return (
    <Sheet
      title={
        <>
          Proactive Ticket draft · <span className="mono">{qrow.name}</span>
        </>
      }
      subtitle={
        <>
          Pre-filled from this run. Device category mapped from the model:{' '}
          <b style={{ color: 'var(--dim-hi)' }}>{proactiveProductWhy(qrow)}</b>.{' '}
          <b style={{ color: 'var(--amber)' }}>Never submits — drafts only.</b>
        </>
      }
      closeLabel="Close the ticket draft"
      onClose={onClose}
      foot={
        <>
          <span style={{ fontSize: 11, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
            <b
              className="mono"
              style={{
                color: missing.length ? 'var(--amber)' : 'var(--green)',
              }}
            >
              {filled}/{requiredTotal}
            </b>{' '}
            required
          </span>
          <span
            className="meter"
            role="progressbar"
            aria-valuenow={filled}
            aria-valuemin={0}
            aria-valuemax={requiredTotal}
            aria-label="Required fields filled"
          >
            <i
              style={{
                width: `${(filled / requiredTotal) * 100}%`,
                background: missing.length ? 'var(--amber)' : 'var(--green)',
              }}
            />
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onAddToBatch(payload);
              say(`${qrow.name} added to the ticket batch.`);
            }}
          >
            Add to batch
          </button>
          <CopyButton
            className="btn btn-primary"
            text={() => proactiveTicketText(payload as unknown as Record<string, unknown>)}
            onDone={(ok) =>
              say(
                ok
                  ? 'Ticket payload copied — paste it into your ticketing system yourself.'
                  : 'Copy blocked by the browser.',
              )
            }
          >
            Copy payload
          </CopyButton>
        </>
      }
    >
      {payload.ownerVerify ? (
        <p
          className="note"
          style={{
            borderColor: 'rgb(240 160 32 / 0.35)',
            background: 'rgb(240 160 32 / 0.08)',
            fontSize: 12,
          }}
        >
          Owner <span className="mono">{qrow.user}</span> looks like an admin, service or shared
          account. Verify the true owner before submitting.
        </p>
      ) : null}

      {PROACTIVE_FIELDS.map((f) => {
        const value = values[f.key] ?? '';
        const sug = String(suggested[f.key] ?? '');
        const manual = f.key === 'ownerName';
        const marker = manual
          ? {
              cls: 'tag-manual',
              text: 'manual — the export carries an owner ID only',
            }
          : value && value === sug
            ? { cls: 'tag-suggested', text: 'suggested' }
            : value !== sug
              ? { cls: 'tag-overridden', text: 'overridden' }
              : null;
        const id = `ticket-${f.key}`;
        const common = {
          id,
          className: f.kind === 'textarea' ? 'mono textarea' : 'input',
          value,
          onChange: (
            e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
          ) => setValues((v) => ({ ...v, [f.key]: e.target.value })),
        };
        return (
          <div className="field" key={f.key}>
            <label
              className="field-label"
              htmlFor={id}
              style={{ display: 'flex', gap: 6, alignItems: 'center' }}
            >
              {f.label}
              {f.required ? (
                <span style={{ color: 'var(--red)' }} aria-label="required">
                  *
                </span>
              ) : null}
              {marker ? (
                <span
                  className={`tag ${marker.cls}`}
                  style={{
                    display: 'inline-flex',
                    gap: 3,
                    alignItems: 'center',
                  }}
                >
                  {marker.cls === 'tag-overridden' ? (
                    <PenLine size={9} aria-hidden />
                  ) : (
                    <Sparkle size={9} aria-hidden />
                  )}
                  {marker.text}
                </span>
              ) : null}
            </label>
            {f.options ? (
              <select {...common} className="select">
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.kind === 'textarea' ? (
              <textarea {...common} rows={3} />
            ) : (
              <input
                {...common}
                type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'text' : 'text'}
              />
            )}
          </div>
        );
      })}
    </Sheet>
  );
}

/** The bulk CSV the batch produces, so the old export still exists. */
export function batchCSV(payloads: ProactiveTicket[]): string {
  return ticketsCSV(payloads as unknown as Record<string, unknown>[]);
}

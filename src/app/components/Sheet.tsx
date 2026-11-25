/* ============================================================
   Sheet.tsx — the one sheet, extracted.

   Phase 2 wrote this contract inside the ticket-draft sheet: a right-hand panel over
   a scrim, focus moved in on open, Tab trapped inside, Escape closes,
   focus returns to whatever opened it, body scroll locked. Phase 3 adds
   five more sheets (Export, Findings in, Phases, Roundup, Shortcuts),
   so the contract moves here and ProactiveTicketSheet consumes it rather than each
   sheet re-implementing a focus trap slightly differently.

   Nothing about the behaviour changed: same class names, same
   role="dialog" aria-modal, same Escape handling, same return focus.
   ============================================================ */

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  foot,
  width,
  closeLabel = 'Close',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  foot?: React.ReactNode;
  /** the default is the ticket draft's 560px; the wider sheets say so */
  width?: number;
  closeLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // the document-level Escape listener is registered once; keep it pointed
  // at the current onClose rather than the one from the first render
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    /* Escape has to work even when focus has fallen out of the panel —
       which really happens: press a Save button that disables itself and
       the browser moves focus to <body>, where the panel's own keydown
       handler never sees it. So the same key is also caught at the
       document, and the panel handler stops propagation so the two can
       never both fire. */
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onDocKey);
    return () => {
      document.removeEventListener('keydown', onDocKey);
      document.body.style.overflow = prevOverflow;
      returnTo.current?.focus?.();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        style={width ? { width: `min(${width}px, 100vw)` } : undefined}
      >
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {title}
            </h2>
            {subtitle ? (
              <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.55 }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            aria-label={closeLabel}
            style={{ marginLeft: 'auto' }}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {foot ? <div className="sheet-foot">{foot}</div> : null}
      </div>
    </>
  );
}

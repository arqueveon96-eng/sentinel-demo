/* ============================================================
   bits.tsx — the small shared pieces: pills, copy buttons, the
   sliding-digit number, and the announcement region.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { Glyph } from './Glyph';
import type { Mark } from '@/app/lib/severity';

/* ---------- pill ---------- */

export function Pill({
  label,
  color,
  mark,
  tint = 0.16,
  title,
}: {
  label: string;
  color: string;
  mark?: Mark;
  tint?: number;
  title?: string;
}) {
  return (
    <span
      className="pill"
      title={title}
      style={{
        color,
        background: `color-mix(in srgb, ${color} ${Math.round(tint * 100)}%, transparent)`,
      }}
    >
      {mark ? <Glyph mark={mark} color={color} size={8} /> : null}
      {label}
    </span>
  );
}

/* ---------- copy ---------- */

/**
 * A real button that copies and says so. The label swaps to "Copied" for
 * 1.4s and the change is announced, because on `file://` the clipboard API
 * is unavailable and the fallback can fail silently otherwise.
 */
export function CopyButton({
  text,
  children,
  className = 'btn',
  onDone,
  title,
}: {
  text: string | (() => string);
  children: React.ReactNode;
  className?: string;
  onDone?: (ok: boolean) => void;
  title?: string;
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const run = useCallback(async () => {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    setState(ok ? 'ok' : 'fail');
    onDone?.(ok);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1400);
  }, [text, onDone]);

  return (
    <button type="button" className={className} onClick={() => void run()} title={title}>
      {state === 'idle' ? children : state === 'ok' ? 'Copied' : 'Copy blocked'}
      {state === 'idle' ? (
        <Copy size={12} aria-hidden />
      ) : state === 'ok' ? (
        <Check size={12} aria-hidden />
      ) : null}
    </button>
  );
}

/* ---------- sliding digits ---------- */

/**
 * Motion #3: a number that moved *because the operator acted* slides.
 * Never on first paint — `seen` starts at the mounted value, so the very
 * first render is static no matter what the number is.
 */
export function SlidingNumber({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const first = useRef(true);
  const [prev, setPrev] = useState(value);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      setPrev(value);
      return;
    }
    setPrev(value);
  }, [value]);
  const changed = prev !== value;
  const dir = value > prev ? 1 : -1;

  if (reduce || first.current || !changed) {
    return <span className={className}>{value}</span>;
  }
  return (
    <span className={`digits ${className ?? ''}`} style={{ height: '1em' }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className="digit"
          initial={{ y: dir * 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: dir * -12, opacity: 0, position: 'absolute' }}
          transition={{ duration: 0.22, ease: [0, 0, 0.2, 1] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ---------- announcements ---------- */

export function LiveRegion({ message }: { message: string }) {
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      {message ? (
        <div className="toast" aria-hidden>
          {message}
        </div>
      ) : null}
    </>
  );
}

/** A one-shot announcer: `say('Recorded')` shows a toast for 2s. */
export function useAnnouncer(): [string, (m: string) => void] {
  const [msg, setMsg] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const say = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(''), 2200);
  }, []);
  return [msg, say];
}

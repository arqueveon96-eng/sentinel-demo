/* ============================================================
   Dossier.tsx — the machine in front of you. Header, verdict,
   prediction → outcome, six signals. The bottom panel is passed in:
   the stage decides what the dossier asks for, and nothing above the
   panel changes when the stage does. That is the whole idea.

   Motion #1: device change slides the dossier out left / in from right.
   Motion #4: the signal tiles stagger in at ~40ms.
   Motion #5: the verdict sentence reveals per word, once, ≤400ms.
   All three collapse to instant under prefers-reduced-motion.
   ============================================================ */

import { useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Device, Outcome, QueueRow, Run, Sev } from '@/core/types';
import { proved, signalTiles, verdict, type Seg } from '@/core/verdict';
import { computeStar, ensureStarBands } from '@/core/hristar';
import { cfg, sentinel } from '@/store/sentinel.store';
import { fmt } from '@/core/format';
import { accentColor, bandColor, sevLook, stateColor, tierLook } from '@/app/lib/severity';
import { Pill, SlidingNumber } from '@/app/components/bits';
import { VALIDATION_MIN } from '@/core/validation';

/* ---------- segments ---------- */

function toneColor(tone: Seg['tone'], accent: string): string | undefined {
  switch (tone) {
    case 'sev':
      return accent;
    case 'ok':
      return 'var(--green)';
    case 'dim':
      return 'var(--dim)';
    case 'strong':
      return 'var(--txt)';
    default:
      return undefined;
  }
}

function Segments({ segs, accent }: { segs: Seg[]; accent: string }) {
  return (
    <>
      {segs.map((s, i) => {
        const color = toneColor(s.tone, accent);
        const weight = s.mono || s.tone === 'strong' || s.tone === 'sev' ? 700 : undefined;
        return (
          <span
            key={i}
            className={s.mono ? 'mono' : undefined}
            style={{ color, fontWeight: weight }}
          >
            {s.text}
          </span>
        );
      })}
    </>
  );
}

/* ---------- verdict ---------- */

function VerdictCard({ row }: { row: Device }) {
  const reduce = useReducedMotion();
  const v = useMemo(() => verdict(row, cfg), [row]);
  const accent = accentColor(v.accent);
  const words = v.headline.split(' ');

  return (
    <section className="verdict" style={{ borderLeftColor: accent }} aria-labelledby="verdict-h">
      <p className="mono eyebrow">VERDICT · FROM THE COMMITTED RUN</p>
      <h2 id="verdict-h" className="verdict-head">
        {reduce ? (
          v.headline
        ) : (
          <>
            {words.map((w, i) => (
              <motion.span
                key={`${row.name}-${i}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.18,
                  delay: Math.min(0.22, i * 0.022),
                  ease: [0, 0, 0.2, 1],
                }}
                style={{ display: 'inline-block', whiteSpace: 'pre' }}
              >
                {w}
                {i < words.length - 1 ? ' ' : ''}
              </motion.span>
            ))}
          </>
        )}
      </h2>
      <p className="verdict-evidence">
        <Segments segs={v.evidence} accent={accent} />
      </p>
    </section>
  );
}

/* ---------- HRI*, the experimental parallel track ---------- */

/**
 * PHASE 3: HRI\* is surfaced, read-only, and only where it can do no harm.
 *
 * `computeStar` is still NOT wired into the pipeline — the committed run's
 * hri / sev / hidden / queue fields are byte-for-byte what they were, and
 * `hristar.test.ts` still asserts that applying it moves nothing that
 * drives dispatch. What happens here is that the dossier computes it on a
 * COPY of the row, for display, so the operator can see the fuller uptime
 * curve's opinion beside production HRI. It is labelled, it never sorts
 * anything, and a DIVERGE only ever means "the experimental track reads
 * this harder", because HRI\* >= HRI by design.
 */
function useStar(row: Device): { value: number; sev: Sev; agree: string } | null {
  return useMemo(() => {
    ensureStarBands(cfg, sentinel);
    const copy = computeStar({ ...row }, cfg);
    if (copy.hriStar == null) return null;
    return {
      value: copy.hriStar,
      sev: (copy.sevStar ?? '—') as Sev,
      agree: copy.hriAgree ?? '—',
    };
  }, [row]);
}

/* ---------- prediction → outcome ---------- */

const OUTCOME_WORD: Record<string, { label: string; color: string }> = {
  confirmed_fail: { label: 'Confirmed', color: 'var(--green)' },
  no_fail: { label: 'No failure', color: 'var(--amber)' },
  false_positive: { label: 'False positive', color: 'var(--dim)' },
};

function PredictionCard({
  row,
  run,
  outcome,
  graded,
}: {
  row: Device;
  run: Run | null;
  outcome: Outcome | null;
  graded: number;
}) {
  const sevColor = sevLook(row.sev).color;
  const when = (run?.weekEnding ?? '').slice(5) || '—';
  const rec = outcome && outcome.outcome !== 'pending' ? OUTCOME_WORD[outcome.outcome] : null;
  const star = useStar(row);
  return (
    <section className="prediction" aria-label="Prediction and outcome">
      <p className="mono eyebrow">PREDICTION → OUTCOME</p>
      <p className="pred-row">
        <span className="mono pred-key">{when}</span>
        <span>
          Predicted <b style={{ color: sevColor }}>{row.sev ?? '—'}</b> ·{' '}
          <span className="mono">HRI {fmt(row.hri)}</span>
        </span>
      </p>
      {star ? (
        <p className="pred-row">
          <span className="mono pred-key">HRI*</span>
          <span>
            <span className="mono" style={{ fontWeight: 700 }}>
              {star.value}
            </span>{' '}
            <b style={{ color: sevLook(star.sev).color }}>{star.sev}</b>{' '}
            <span
              className="mono"
              style={{
                fontSize: 10,
                color: star.agree === 'DIVERGE' ? 'var(--purple)' : 'var(--dim)',
              }}
              title={
                star.agree === 'DIVERGE'
                  ? 'The experimental parallel track reads this machine harder than production HRI does. It never drives dispatch.'
                  : 'The experimental parallel track agrees with production HRI.'
              }
            >
              {star.agree}
            </span>
          </span>
        </p>
      ) : null}
      <p className="pred-row">
        <span className="mono pred-key">{rec ? (outcome?.ts ?? '').slice(5, 10) : '—'}</span>
        {rec ? (
          <span>
            <b style={{ color: rec.color }}>{rec.label}</b>
            {outcome?.note ? ` · ${outcome.note}` : ''}
          </span>
        ) : (
          <span style={{ color: 'var(--dim)' }}>Outcome recorded in Close</span>
        )}
      </p>
      {rec && outcome?.leadDays != null ? (
        <p className="pred-row">
          <span className="mono pred-key">lead</span>
          <span className="mono" style={{ fontWeight: 700 }}>
            {outcome.leadDays} {outcome.leadDays === 1 ? 'day' : 'days'}
          </span>
        </p>
      ) : null}
      <p className="ledger">
        <b className="mono" style={{ color: 'var(--txt)' }}>
          <SlidingNumber value={graded} /> / {VALIDATION_MIN}
        </b>{' '}
        outcomes —{' '}
        {graded >= VALIDATION_MIN
          ? 'the bands are credible and tuning can be proposed.'
          : rec
            ? 'this one counts toward tuning the bands.'
            : 'HRI bands stay provisional until then.'}
      </p>
    </section>
  );
}

/* ---------- signal tiles ---------- */

function SignalTiles({ row }: { row: Device }) {
  const reduce = useReducedMotion();
  const tiles = useMemo(() => signalTiles(row, cfg), [row]);
  return (
    <div className="tiles">
      {tiles.map((t, i) => (
        <motion.div
          key={t.key}
          className="tile"
          style={{ borderTopColor: bandColor(t.band) }}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.18, delay: reduce ? 0 : i * 0.04 }}
        >
          <span
            className="mono tile-value"
            style={{ color: t.band === 'dim' ? 'var(--dim)' : bandColor(t.band) }}
          >
            {t.value}
            {t.unit ? <span className="tile-unit">{t.unit}</span> : null}
          </span>
          <span className="tile-label">{t.label}</span>
          <span className={`tile-reading${t.key === 'crashes' ? ' mono' : ''}`} title={t.reading}>
            {t.reading}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

/* ---------- header ---------- */

function Head({
  row,
  qrow,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  row: Device;
  qrow: QueueRow | null;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const sev = sevLook(row.sev);
  const tier = tierLook(row.tier);
  const state = qrow?.state ?? 'NEW';
  const weeks = qrow?.weeks ?? 1;
  const meta = [
    row.user || 'owner unknown',
    row.model || 'model unknown',
    row.os || 'OS unknown',
    row.age == null ? 'first seen —' : `first seen ${row.age} ${row.age === 1 ? 'day' : 'days'} ago`,
    row.seen == null
      ? 'last seen —'
      : row.seen === 0
        ? 'seen today'
        : `last seen ${row.seen} ${row.seen === 1 ? 'day' : 'days'} ago`,
  ].join(' · ');

  return (
    <div className="dossier-head">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div className="dev-pills">
          <h1 className="mono dev-name">{row.name}</h1>
          {row.sev && row.sev !== '—' && row.sev !== 'STABLE' ? (
            <Pill label={row.sev} color={sev.color} mark={sev.mark} />
          ) : null}
          {row.tier && row.tier !== 'HEALTHY' ? (
            <Pill label={row.tier} color={tier.color} mark={tier.mark} title="Composite tier" />
          ) : null}
          {row.hidden ? (
            <Pill
              label="HIDDEN RISK"
              color="var(--purple)"
              mark="circle"
              title="HRI flags it, the composite misses it"
            />
          ) : null}
          <Pill
            label={`${state.replace('_', ' ')} · week ${weeks}`}
            color={stateColor(state)}
            tint={0.14}
          />
        </div>
        <p className="dev-meta">{meta}</p>
      </div>
      <div className="navbtns">
        <button type="button" className="btn btn-quiet" onClick={onPrev} disabled={!hasPrev}>
          <ArrowLeft size={12} aria-hidden />
          Previous
        </button>
        <button type="button" className="btn" onClick={onNext} disabled={!hasNext}>
          Next machine
          <ArrowRight size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/* ---------- the dossier ---------- */

export function Dossier({
  row,
  qrow,
  run,
  outcome,
  graded,
  direction,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  panel,
}: {
  row: Device;
  qrow: QueueRow | null;
  run: Run | null;
  outcome: Outcome | null;
  graded: number;
  direction: 1 | -1;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  panel: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const slide = reduce ? 0 : 28;
  return (
    <div className="dossier">
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={row.name}
          custom={direction}
          initial={{ opacity: 0, x: direction * slide }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -slide }}
          transition={{ duration: reduce ? 0 : 0.18, ease: [0, 0, 0.2, 1] }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <Head
            row={row}
            qrow={qrow}
            onPrev={onPrev}
            onNext={onNext}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
          <div className="cards">
            <VerdictCard row={row} />
            <PredictionCard row={row} run={run} outcome={outcome} graded={graded} />
          </div>
          <SignalTiles row={row} />
        </motion.div>
      </AnimatePresence>
      {panel}
    </div>
  );
}

/** Exported for the Close panel, which shows the same sentence. */
export { proved, Segments };

/* ============================================================
   derived.ts — the hooks that turn the store blob into what the views
   need. Every one of them recomputes from the ported core, so the
   numbers on screen are the core's numbers, not a second opinion.
   ============================================================ */

import { useMemo } from 'react';
import { useSentinelStore, cfg, sentinel } from '@/store/sentinel.store';
import { buildQueue } from '@/core/queue';
import { triageList } from '@/core/investigate';
import { validationMetrics } from '@/core/validation';
import type { Device, Outcome, QueueRow, Run, SentinelState } from '@/core/types';
import { deriveStages, type Stage } from './stages';
import { useUi } from './ui.store';

export function useBlob(): SentinelState {
  return useSentinelStore((s) => s.blob);
}

/** Bumped on every store mutation — the memo key for anything derived. */
export function useRev(): number {
  return useSentinelStore((s) => s.rev);
}

export function useRun(): Run | null {
  const rev = useRev();
  return useMemo(() => sentinel.currentRun(), [rev]);
}

export function useQueue(): QueueRow[] {
  const rev = useRev();
  return useMemo(() => {
    const run = sentinel.currentRun();
    return run ? buildQueue(run, cfg, sentinel) : [];
  }, [rev]);
}

export function useTriage(): Device[] {
  const rev = useRev();
  return useMemo(() => {
    const run = sentinel.currentRun();
    return run ? triageList(run, cfg) : [];
  }, [rev]);
}

export function useStages(): Stage[] {
  const rev = useRev();
  const queue = useQueue();
  const staged = useUi((s) => s.staged.length);
  return useMemo(() => {
    const run = sentinel.currentRun();
    return deriveStages({
      run,
      queue,
      overlay: run?.overlay ?? {},
      outcomes: sentinel.getOutcomes(),
      staged,
    });
    // `rev` is the dependency that matters; queue/staged are derived from it
  }, [rev, queue, staged]);
}

/**
 * The row as the operator should see it: the frozen baseline with the
 * overlay on top. The baseline itself is never mutated — the overlay is
 * how a finding is applied, and this is where the two are combined.
 */
export function useEffectiveRow(name: string | null): Device | null {
  const rev = useRev();
  return useMemo(() => {
    if (!name) return null;
    const run = sentinel.currentRun();
    const base = run?.rows.find((r) => r.name === name);
    if (!base) return null;
    const overlay = sentinel.getOverlay(name);
    return Object.keys(overlay).length ? { ...base, ...overlay } : base;
  }, [name, rev]);
}

/** The fields a finding wrote for this device, for the "recorded" strip. */
export function useOverlay(name: string | null): Record<string, unknown> {
  const rev = useRev();
  return useMemo(() => (name ? sentinel.getOverlay(name) : {}), [name, rev]);
}

export function useOutcomeFor(name: string | null): Outcome | null {
  const rev = useRev();
  return useMemo(() => {
    if (!name) return null;
    const run = sentinel.currentRun();
    const all = sentinel.getOutcomes();
    return (
      all.find((o) => o.device === name && (!run || o.week === run.weekEnding)) ??
      all.find((o) => o.device === name) ??
      null
    );
  }, [name, rev]);
}

export function useLedger() {
  const rev = useRev();
  return useMemo(() => validationMetrics(sentinel), [rev]);
}

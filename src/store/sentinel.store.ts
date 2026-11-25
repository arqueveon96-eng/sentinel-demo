/* ============================================================
   sentinel.store.ts — the React binding.

   The ported `createStore()` (src/core/store-core.ts) owns all state
   transitions; this module owns React subscription and persistence
   wiring. Every mutation goes through the core store, so the vanilla
   app's semantics (unshift order, slice caps, save timing, changelog
   journalling) are the ones React sees.

   Persistence uses zustand `persist` with the custom legacy storage
   adapter from ./legacy-storage, so the on-disk shape under
   `sentinel.v1` stays the bare legacy blob the old app's importBlob
   accepts.
   ============================================================ */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Cfg, Run, SentinelState, SourceFile } from '@/core/types';
import { SCHEMA_VERSION, createStore, type SentinelStore } from '@/core/store-core';
import { makeCfg } from '@/core/scoring';
import { applyStoredConfig } from '@/core/config';
import { ingestAndCommit, type BuildRunResult } from '@/core/pipeline';
import { makeRunMeta, mergeRunMeta, readRunMeta } from '@/core/trends';
import {
  createLegacyPersistStorage,
  createPersistence,
  createRawBlobIO,
  type PersistedSlice,
} from './legacy-storage';

const io = createRawBlobIO();

/** The live, mutable CFG object — the legacy `CFG` global, now owned here. */
export const cfg: Cfg = makeCfg();

/**
 * The ported store singleton. Exported so non-React code (and tests) can drive
 * the same instance the UI is bound to.
 */
export const sentinel: SentinelStore = createStore(createPersistence(io), {
  onQuotaError: (msg) => console.error('[sentinel]', msg),
  onChange: (state) => {
    // replace the blob reference so React re-renders; the object identity of
    // `state` is stable inside the core store, so bump a revision counter too.
    useSentinelStore.setState((s) => ({ blob: state, rev: s.rev + 1 }));
  },
});

// hydrate the config from an existing blob before anything is scored
applyStoredConfig(cfg, sentinel);

/**
 * PHASE 3, ADDITIVE: the full per-week composition the charts need.
 *
 * `commitRun` writes a `runHistory` entry carrying only CRITICAL, HIGH,
 * hidden and the two averages — not the ELEVATED/MONITOR/HEALTHY split
 * and not the HRI bands. `commitRun` is a ported module and this phase
 * does not edit those, so the week's full composition is written here
 * instead, as an extra top-level key beside the legacy eleven.
 *
 * This is safe by the store's own contract: `load()` JSON.parses the
 * blob and uses it outright, so an unknown key survives a full
 * read/mutate/write cycle (asserted in store-compat.test.ts), and the
 * original console ignores anything it does not read. Weeks committed
 * before this existed simply have no record, and `trendPoints` marks
 * those points `full: false` rather than inventing a composition.
 */
function recordRunMeta(run: Run): void {
  const s = sentinel.load() as SentinelState & { runMeta?: unknown };
  s.runMeta = mergeRunMeta(readRunMeta(s), makeRunMeta(run));
  sentinel.save();
}

interface SentinelSlice extends PersistedSlice {
  rev: number;
  /** the whole /pull path: parse -> score -> summarize -> commit */
  ingest(weekEnding: string, files: SourceFile[]): BuildRunResult;
  currentRun(): Run | null;
  exportBlob(): string;
  /** stamps `lastExport` so the Export sheet can say when the last backup was taken */
  markExported(when?: string): void;
  importBlob(text: string): void;
  /** re-read after a mutation made directly on the core store */
  touch(): void;
  reset(): void;
}

export const useSentinelStore = create<SentinelSlice>()(
  persist(
    (set) => ({
      blob: sentinel.load(),
      rev: 0,
      ingest(weekEnding: string, files: SourceFile[]) {
        const result = ingestAndCommit(weekEnding, files, cfg, sentinel);
        recordRunMeta(result.run);
        set((s) => ({ blob: sentinel.load(), rev: s.rev + 1 }));
        return result;
      },
      currentRun: () => sentinel.currentRun(),
      exportBlob: () => sentinel.exportBlob(),
      markExported(when = new Date().toISOString()) {
        const s = sentinel.load() as SentinelState & { lastExport?: string };
        s.lastExport = when;
        sentinel.save();
        set((st) => ({ blob: sentinel.load(), rev: st.rev + 1 }));
      },
      importBlob(text: string) {
        sentinel.importBlob(text);
        applyStoredConfig(cfg, sentinel);
        set((s) => ({ blob: sentinel.load(), rev: s.rev + 1 }));
      },
      /** Bump `rev` after a mutation made straight through the core store. */
      touch() {
        set((s) => ({ blob: sentinel.load(), rev: s.rev + 1 }));
      },
      reset() {
        sentinel.reset();
        set((s) => ({ blob: sentinel.load(), rev: s.rev + 1 }));
      },
    }),
    {
      name: 'sentinel.v1',
      // must match what the adapter reports, or persist logs a migration error
      version: SCHEMA_VERSION,
      storage: createLegacyPersistStorage(io),
      partialize: (s): PersistedSlice => ({ blob: s.blob }),
      // A hydrated legacy blob is authoritative: push it into the core store
      // rather than letting an empty in-memory state overwrite it.
      onRehydrateStorage: () => (hydrated?: SentinelSlice) => {
        if (!hydrated?.blob) return;
        const current: SentinelState = sentinel.load();
        if (current.updated == null && hydrated.blob.updated != null) {
          sentinel.importBlob(JSON.stringify(hydrated.blob));
          applyStoredConfig(cfg, sentinel);
        }
      },
    },
  ),
);

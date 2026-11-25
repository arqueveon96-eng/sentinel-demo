/* ============================================================
   fixtures.ts — shared test scaffolding.

   SAMPLE DATA: every suite reads the committed, SYNTHETIC
   `demo/sample-fleet.csv` (300 devices). It is produced by
   `scripts/make-sample-fleet.mjs` from a fixed seed, so regenerating it
   reproduces the same bytes and a failing assertion is always
   reproducible. The tests read the file rather than re-running the
   generator so a change to the generator shows up as a reviewed diff.
   ============================================================ */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore, type Persistence, type SentinelStore } from '@/core/store-core';
import { makeCfg } from '@/core/scoring';
import { buildRun } from '@/core/pipeline';
import type { Cfg, Run, Ingested, SourceFile } from '@/core/types';

export const SAMPLE_PATH = resolve(process.cwd(), 'demo/sample-fleet.csv');

export function sampleFile(): SourceFile {
  return { name: 'sample-fleet.csv', text: readFileSync(SAMPLE_PATH, 'utf8') };
}

/** An in-memory Persistence for the store. */
export function memoryPersistence(seed?: Record<string, string>): Persistence {
  const d = new Map<string, string>(Object.entries(seed || {}));
  return {
    getItem: (k) => d.get(k) ?? null,
    setItem: (k, v) => void d.set(k, v),
    removeItem: (k) => void d.delete(k),
  };
}

export interface Harness {
  cfg: Cfg;
  store: SentinelStore;
  loadRun(week: string, files?: SourceFile[]): { run: Run; ing: Ingested };
}

/** Ingest + score the sample under a given week-ending date. */
export function makeHarness(persistence: Persistence = memoryPersistence()): Harness {
  const cfg = makeCfg();
  const store = createStore(persistence);
  return {
    cfg,
    store,
    loadRun(week, files) {
      return buildRun(week, files || [sampleFile()], cfg, store.currentRun());
    },
  };
}

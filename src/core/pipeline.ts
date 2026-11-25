/* ============================================================
   pipeline.ts — the ingest -> score -> summarize chain, in one place.

   This is NEW code, not a port: in the vanilla app the same six calls
   were spelled out inline in app.js (`ingestCommit`) and again in
   test_all.js (`loadRun`). Both spellings are identical, so factoring
   them out changes no behaviour (a parity suite in the original repo
   ran both over the same input and compared, device by device).
   ============================================================ */

import type { Cfg, Ingested, Run, SourceFile, StoreApi } from './types';
import { ingestFiles, ingestReport } from './ingest';
import { assignTriage, ceilingDiagnostics, scoreDevice, summarize } from './scoring';

export interface BuildRunResult {
  run: Run;
  ing: Ingested;
}

/**
 * @param weekEnding  the run's week label
 * @param files       the CSV texts to merge (first file wins on conflicts)
 * @param cfg         live config
 * @param prior       previously committed run, for anomaly detection (or null)
 */
export function buildRun(
  weekEnding: string,
  files: SourceFile[],
  cfg: Cfg,
  prior: Run | null,
): BuildRunResult {
  const ing = ingestFiles(files);
  ing.devices.forEach((d) => scoreDevice(d, cfg));
  assignTriage(ing.devices);
  const run: Run = {
    weekEnding,
    committedAt: new Date().toISOString(),
    rows: ing.devices,
    report: ingestReport(ing, prior),
    ceiling: ceilingDiagnostics(ing.devices, cfg),
    summary: summarize(ing.devices, cfg),
  };
  return { run, ing };
}

/** buildRun + commit, the whole `/pull` path. */
export function ingestAndCommit(
  weekEnding: string,
  files: SourceFile[],
  cfg: Cfg,
  store: StoreApi,
): BuildRunResult {
  const result = buildRun(weekEnding, files, cfg, store.currentRun());
  store.commitRun(result.run);
  return result;
}

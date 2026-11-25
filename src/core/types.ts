/* ============================================================
   types.ts — the shared shapes of the ported core.
   Every field name is the legacy field name. Nothing renamed.
   ============================================================ */

/* ---------- config (legacy CFG) ---------- */

export interface CrsWeights {
  dex: number;
  crash: number;
  age: number;
  ram: number;
  storage: number;
  os: number;
  avail: number;
}
export interface CrsTiers {
  CRITICAL: number;
  HIGH: number;
  ELEVATED: number;
  MONITOR: number;
}
export interface HriBands {
  FAILING: number;
  DEGRADING: number;
  WATCH: number;
}

/**
 * Legacy `CFG`. In the vanilla app this was a module-level global mutated in
 * place by config.js. Here it is an explicit, mutable object threaded through
 * every function that used to read the global. Mutation semantics are kept
 * (applyStoredConfig / resetConfigDefaults mutate the object you hand them),
 * because the original test suite asserts on the live object after a save.
 */
export interface Cfg {
  crsW: CrsWeights;
  crsTier: CrsTiers;
  hriBand: HriBands;
  excludePatterns: RegExp[];
  /** experimental HRI* bands — see hristar.ts. Absent unless the add-on is used. */
  hriStarBand?: HriBands;
}

/** The serialized form persisted under `config` in the store blob. */
export interface StoredConfig {
  crsW?: Partial<CrsWeights>;
  crsTier?: Partial<CrsTiers>;
  hriBand?: Partial<HriBands>;
  excludeSrc?: string[];
  hriStarBand?: Partial<HriBands>;
  [k: string]: unknown;
}

/** The shape config.ts `saveConfig`/`validateConfig` accept. */
export interface ConfigInput {
  crsW: CrsWeights;
  crsTier: CrsTiers;
  hriBand: HriBands;
  excludeSrc: string[];
}

/* ---------- devices ---------- */

export type Tier = 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'MONITOR' | 'HEALTHY';
export type Sev = 'FAILING' | 'DEGRADING' | 'WATCH' | 'STABLE' | '—';
export type HriMode = 'counts' | 'counts-partial' | 'unavailable';

export interface CrsPoints {
  dex: number;
  crash: number;
  age: number;
  ram: number;
  storage: number;
  os: number;
  avail: number;
  [k: string]: number;
}

export interface WeightedContribution {
  DEX: number;
  Crashes: number;
  Age: number;
  RAM: number;
  Storage: number;
  OS: number;
  Availability: number;
  [k: string]: number;
}

/**
 * A device row. Every field is optional because the legacy code is fed
 * partially-populated literals all over the regression suite
 * (e.g. `scoreDevice({name:'T', dex:null})`) and must behave identically.
 */
export interface Device {
  name?: string;
  user?: string;
  model?: string;
  os?: string;
  age?: number | null;
  seen?: number | null;
  boot?: number | null;
  ramGB?: number | null;
  dex?: number | null;
  crashes?: number | null;
  free?: number | null;
  hrScore?: number | null;
  relScore?: number | null;
  scScore?: number | null;
  hardResets?: number | null;
  crashCount?: number | null;
  bugcheckCode?: string | null;
  bugcheckLabel?: string | null;
  lastBugcheck?: string | null;
  _src?: Record<string, unknown>;

  /* written by scoreDevice */
  pts?: CrsPoints;
  crs?: number;
  wtd?: WeightedContribution;
  driver?: string;
  tier?: Tier;
  hri?: number | null;
  sev?: Sev;
  hriMode?: HriMode;
  hriParts?: { reset: number; crash: number; soft: number } | null;
  excluded?: boolean;
  hidden?: boolean;
  queue?: boolean;

  /* written by assignTriage */
  triage?: Tier;

  /* written by the experimental hristar add-on */
  burstFlag?: boolean;
  hriStar?: number | null;
  sevStar?: Sev;
  burst?: boolean;
  hriAgree?: 'MATCH' | 'DIVERGE' | '—';
  hriStarParts?: { reset: number; crash: number; soft: number; burst: boolean } | null;

  [k: string]: unknown;
}

/* ---------- ingest ---------- */

export interface SourceFile {
  name: string;
  text: string;
}

export interface PerFileReport {
  file: string;
  rows: number;
  err?: string;
  rejected?: number;
  hasCounts?: boolean;
  shape?: string;
}

export interface Ingested {
  devices: Device[];
  perFile: PerFileReport[];
  headers: string[];
}

export interface CoverageEntry {
  field: string;
  role: string;
  req: boolean;
  present: boolean;
  column: string | null;
}

export interface NullRates {
  dex: number;
  crashes: number;
  free: number;
  ramGB: number;
  age: number;
  hardResets: number;
}

export interface IngestReport {
  fileCount: number;
  perFile: PerFileReport[];
  deviceCount: number;
  rejected: number;
  coverage: CoverageEntry[];
  missingReq: CoverageEntry[];
  /** NOTE: a different vocabulary from Device.hriMode — see the B-08 note in ingest.ts. */
  hriMode: string;
  hriReset: boolean;
  hriCrash: boolean;
  nulls: NullRates;
  anomalies: string[];
  gate: 'clean' | 'block' | 'review';
}

/* ---------- summary / ceiling / run ---------- */

export interface Summary {
  total: number;
  inScope: number;
  excluded: number;
  avgDEX: number | null;
  avgCRS: number;
  tierCounts: Record<Tier, number>;
  sevCounts: Record<'FAILING' | 'DEGRADING' | 'WATCH' | 'STABLE', number>;
  hidden: number;
  hriWatch: number;
  hriAvail: number;
}

export interface Ceiling {
  maxObserved: number;
  maxAttainable: number;
  blockingCeiling: boolean;
  zeroPct: Record<string, number>;
  inert: Record<string, boolean>;
}

export interface Investigation {
  phaseNotes: Record<string, string>;
  updated: string | null;
}

export interface Run {
  weekEnding: string;
  committedAt: string;
  rows: Device[];
  report: IngestReport;
  ceiling: Ceiling;
  summary: Summary;
  overlay?: Record<string, Record<string, unknown>>;
  investigation?: Investigation;
  [k: string]: unknown;
}

export interface RunHistoryEntry {
  weekEnding: string;
  committedAt: string;
  deviceCount: number;
  avgCRS: number;
  avgDEX: number | null;
  critical: number;
  high: number;
  hriWatch: number;
  hidden: number;
}

/* ---------- queue / work ---------- */

export type QueueState =
  | 'NEW'
  | 'TRIAGED'
  | 'ACTIONED'
  | 'RESOLVED'
  | 'DEFERRED'
  | 'FALSE_POSITIVE';
export type WorkState = 'notstarted' | 'inprogress' | 'done';

export interface QueueHistoryEntry {
  state: string;
  source: string;
  ts: string;
}

export interface QueueMeta {
  state: QueueState;
  assignee: string;
  ticketId: string;
  consecutiveWeeks: number;
  firstWeek: string | null;
  lastWeek: string | null;
  deferReason: string;
  revisitDate: string;
  history: QueueHistoryEntry[];
  recurred?: boolean;
  [k: string]: unknown;
}

export interface WorkEntry {
  state: WorkState;
  note: string;
  updated: string | null;
  raw?: QueueState;
}

export interface QueueReason {
  rank: number;
  label: string;
  cls: string;
}

export interface QueueRow {
  name: string;
  user?: string;
  model?: string;
  crs?: number;
  tier?: Tier;
  hri?: number | null;
  sev?: Sev;
  driver?: string;
  dex?: number | null;
  bugcheck?: string | null;
  reason: QueueReason;
  work: WorkState;
  state: QueueState;
  assignee: string;
  ticketId: string;
  weeks: number;
  recurred: boolean;
  deferReason: string;
  revisitDate: string;
  escalate: boolean;
  hidden?: boolean;
  [k: string]: unknown;
}

export interface QueueCounts {
  total: number;
  done: number;
  inprogress: number;
  notstarted: number;
  escalate: number;
  unassigned: number;
  byReason: Record<string, number>;
  [k: string]: unknown;
}

/* ---------- changelog / handoff / outcomes ---------- */

export interface ChangelogEntry {
  device: string;
  field: string;
  old: unknown;
  new: unknown;
  source: string;
  ts: string;
}

export interface HandoffEntry {
  direction: 'in' | 'out';
  platform: string;
  summary: string;
  count: number | null;
  week: string | null;
  ts: string;
}

export interface Outcome {
  device: string;
  week: string | null;
  predictedSev: string | null;
  predictedTier: string | null;
  hri: number | null;
  crs: number | null;
  outcome: string;
  component: string;
  leadDays: number | null;
  note: string;
  ts: string;
}

export interface OutcomeInput {
  device: string;
  week?: string | null;
  predictedSev?: string | null;
  predictedTier?: string | null;
  hri?: number | null;
  crs?: number | null;
  outcome: string;
  component?: string;
  leadDays?: number | null;
  note?: string;
}

export interface TuningRecord {
  ts: string;
  change: unknown;
}

/* ---------- the persisted blob (legacy `sentinel.v1`) ---------- */

export interface SentinelState {
  schemaVersion: number;
  committedRun: Run | null;
  runHistory: RunHistoryEntry[];
  changelog: ChangelogEntry[];
  handoffLog: HandoffEntry[];
  workState: Record<string, WorkEntry>;
  queueMeta: Record<string, QueueMeta>;
  config: StoredConfig | null;
  outcomes: Outcome[];
  lastTuning: TuningRecord | null;
  updated: string | null;
  [k: string]: unknown;
}

/**
 * The surface of the legacy `Store` global that the ported core modules
 * consume. Structural only — `src/core/` never imports the implementation,
 * so the core stays dependency-free.
 */
export interface StoreApi {
  load(): SentinelState;
  save(): boolean;
  get(): SentinelState;

  commitRun(run: Run): void;
  currentRun(): Run | null;

  applyFinding(
    device: string,
    changes: Record<string, unknown>,
    source: string,
  ): boolean;
  getOverlay(device: string): Record<string, unknown>;
  eff(row: Device, field: string): unknown;

  getChangelog(): ChangelogEntry[];
  clearChangelog(): void;

  logHandoff(
    direction: 'in' | 'out',
    platform: string,
    summary: string,
    count?: number | null,
  ): void;
  getHandoffLog(): HandoffEntry[];

  savePhaseNote(phase: string | number, text: string): void;
  getPhaseNote(phase: string | number): string;

  setWork(device: string, state: WorkState, note?: string | null): void;
  getWork(device: string): WorkEntry;

  setDeviceState(device: string, rawVal: string, source?: string): void;
  getQueue(device: string): QueueMeta;
  setQueueField(
    device: string,
    field: string,
    val: unknown,
    source?: string,
  ): void;
  carryForwardQueue(run: Run, queuedNames: string[]): void;

  getConfig(): StoredConfig | null;
  setConfig(cfg: StoredConfig): void;
  resetConfig(): void;

  addOutcome(o: OutcomeInput): void;
  getOutcomes(): Outcome[];
  removeOutcome(idx: number): void;

  getLastTuning(): TuningRecord | null;
  recordTuning(change: unknown): void;
  tuningAllowed(): { allowed: boolean; daysLeft: number };

  exportBlob(): string;
  importBlob(text: string): void;
  reset(): void;
}

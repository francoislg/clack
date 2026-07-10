import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "./logger.js";
import { errorMessage } from "./errors.js";
import { fileExists } from "./fs.js";
import { getCronMaxRunHistory } from "./config.js";
import type { SettableAttentionLevel } from "./sessions.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Structured calendar-date skip. When a `CronJob` carries any entries matching today's date
 * (in the job's `timezone`), the scheduler skips the run deterministically — no Claude session
 * is opened, no tokens are spent. Composes with `skipConditions`: evaluated first.
 */
export interface SkipDate {
  /**
   * `YYYY-MM-DD` for an exact calendar date, or `MM-DD` for a date that recurs annually.
   * Compared against `today` formatted in `job.timezone`.
   */
  date: string;
  /** Human-readable label, surfaced in info logs when the entry matches. */
  label: string;
}

export interface CronRun {
  executedAt: string;
  status: "success" | "error" | "skipped";
  /** Slack message timestamp — absent when delivery failed or was skipped */
  responseTs?: string;
  /**
   * ISO datetime of the run this entry was a replay of — set when the run was fired
   * on-demand via `run_scheduled_message_now` with an `asOf` argument. Absent for
   * normal scheduler-tick fires and for plain run-now invocations without `asOf`.
   */
  replayOf?: string;
}

export interface CronJob {
  id: string;
  cronExpression: string;
  /**
   * Slack channel ID this job posts to. Optional: a channelless dynamic job decides
   * its delivery destination at fire time by calling `post_to` from within the Claude
   * session — used by plugin-managed jobs that evaluate multiple candidate channels
   * per fire. When absent, the `submit_response` schema is forced into the
   * `"optional-post-to"` shape regardless of the persisted `submitResponseMode` (see the
   * `submit-response-mode` capability): there is no bound channel for a primary response,
   * so the only delivery path is a `post_to` action call from Claude (or a bare skip).
   */
  channel?: string;
  /** What Claude does each tick */
  prompt: string;
  /**
   * Optional short human-readable label (1-80 chars) shown in the Home Tab schedule rows
   * and interpolated into Slack task-card mappings via the `{name|id}` fallback. Purely
   * decorative — never used as a lookup key, never enforced unique. Absent on legacy
   * rows persisted before names were introduced; the `{name|id}` fallback keeps those
   * rendering with the UUID.
   */
  name?: string;
  /**
   * Slack user ID for user-created jobs; `null` for jobs owned by the bot itself
   * (e.g. plugin-managed crons). When `null`, `systemActor` MUST be set to
   * identify the non-user origin.
   */
  createdBy: string | null;
  /**
   * Non-user origin identifier for system-owned jobs. Set when and only when
   * `createdBy === null`. The current shape is `"plugin:<ownerKey>"` for jobs
   * emitted by `sdk.reconcileCronJobs`.
   */
  systemActor?: string;
  createdAt: string;
  enabled: boolean;
  timezone: string;
  oneShot?: boolean;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error" | "skipped";
  /**
   * Fully-qualified MCP tool names (e.g., `mcp__trivia__submit_answers`) that must be called during
   * this dynamic job's run before `submit_response` will be accepted. Ignored for static jobs.
   */
  requiredTools?: string[];
  /**
   * Name of a loaded Clack plugin this job is associated with. Currently informational —
   * the cron scheduler does not derive required-tools from this field (see
   * `computeEffectiveRequiredTools`); `requiredTools` above is the single source of truth.
   */
  plugin?: string;
  /**
   * Free-form text listing conditions under which this scheduled run should skip posting.
   * When set, the scheduled session's prompt injects a pre-check instruction and the
   * `submit_response` tool schema exposes `skip_response` so Claude can decline delivery.
   * Ignored for static jobs (no Claude session exists to evaluate them).
   */
  skipConditions?: string;
  /**
   * Declarative override of the `submit_response` schema/gating behavior. When set, it takes
   * precedence over the auto-derivation from `triggerType` + `skipConditions`:
   * - `"always"` — `skip_response` is NOT in the schema; the run MUST deliver.
   * - `"optional"` — `skip_response` IS in the schema as an optional boolean.
   * - `"optional-post-to"` — the schema exposes `actions` (so `post_to` works) + an optional
   *   `skip_response`, but no primary delivery fields. The run delivers via `post_to` (which
   *   carries its own channel) OR skips. Used for channelless runs with no bound channel.
   * - `"skipped"` — the entire schema is replaced by `{ skip_response: z.literal(true) }`; the
   *   run MUST decline delivery. Use when the run's actual deliverable is produced by another
   *   required tool (e.g. trivia's `post_questions`) and `submit_response` is purely a
   *   run terminator.
   *
   * When unset, today's auto-derivation rules apply unchanged. See the `submit-response-mode`
   * capability for the full resolution table.
   */
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /**
   * When true, the fire suppresses ALL Slack output — the primary `submit_response` delivery, the
   * worker `report_status` posts, and change-lifecycle status posts. The job still runs against
   * its real {@link channel} so change auto-execution proceeds (it is not treated as a channelless
   * dispatch), and GitHub-side effects are unaffected. Forwarded by the scheduler into
   * `processMessage`. Plugins set it via `CronJobSpec.silent`. See the `silent-change-execution`
   * capability.
   */
  silent?: boolean;
  /**
   * Structured date-based skip list. Evaluated by the scheduler before opening a Claude session
   * (and before {@link skipConditions}). When today (in {@link timezone}) matches any entry, the
   * run is recorded as `status: "skipped"` and `processMessage` is never invoked.
   */
  skipDates?: SkipDate[];
  /**
   * True when this job was created by a plugin's `reconcileCronJobs` call.
   * Plugin-managed jobs are shown read-only on the Home Tab (toggle Enable/Disable only;
   * no Edit, no Delete) and rejected by user-facing edit/delete tools. Absent for user-created jobs.
   */
  pluginManaged?: boolean;
  /**
   * Stable identity within a plugin's reconcile owner. Present iff `pluginManaged === true`.
   * Combined with `plugin` (the owner key), it lets reconcile match an incoming spec to an
   * existing job and update in place (preserving id/runs[]/enabled).
   */
  specKey?: string;
  /**
   * Topic names to pre-attach when this job fires. The cron scheduler forwards the array
   * into `processMessage` as `preAttachedTopics`, which surfaces `topics/<topic>/*.md`
   * instruction files (including plugin virtual defaults registered via
   * `sdk.addTopicInstruction`) in the system prompt from the first turn. Populated by
   * plugin reconcile when the `CronJobSpec.attachedTopics` field is set. Absent for
   * jobs that don't pre-attach any topic. Ignored for static jobs (no Claude session).
   * See the `plugin-topic-instructions` capability.
   */
  attachedTopics?: string[];
  /**
   * Attention level seeded onto the session this job's fire creates. Forwarded by the cron
   * scheduler into `processMessage`. Absent → the session defaults to `"medium"`. Plugins set
   * it via `CronJobSpec.attentionLevel`.
   */
  attentionLevel?: SettableAttentionLevel;
  /**
   * Maximum minutes the effective fire may be delayed past the canonical cron slot. When set
   * (a positive integer), the scheduler shifts the 60-second match window forward by a
   * deterministic per-occurrence offset in `[0, jitterMinutes)` minutes so the cadence reads
   * as organic instead of always landing on the exact slot (e.g. `:15`). The stored
   * `cronExpression` is never modified — jitter applies only to the match computation.
   * Absent or `0` → no jitter (fires on the canonical slot, today's behavior). Plugins set it
   * via `CronJobSpec.jitterMinutes`. Ignored for static jobs (no scheduler match needed).
   */
  jitterMinutes?: number;
  /**
   * Recent execution history (most recent last). Capped by
   * `config.cron.maxRunHistory` (default 50); older entries are
   * dropped from the front when {@link updateJobRunStatus} records a new run.
   */
  runs?: CronRun[];
}

interface CronJobState {
  jobs: CronJob[];
  /**
   * Jobs that failed per-element validation, preserved VERBATIM (raw `unknown`) so a single bad
   * job never wipes the collection and a repair is always possible. Never scheduled (structurally
   * isolated — the scheduler only ever iterates {@link jobs}). Round-tripped untouched by every
   * {@link saveState} write, so an unrelated save (e.g. plugin reconcile on boot) can't overwrite
   * a quarantined job out of existence — the mechanism that made the 2026-07-06 loss permanent.
   */
  quarantinedJobs?: unknown[];
}

/** One quarantined job as surfaced to the owner DM and the Home Tab panel. */
export interface CronQuarantineEntry {
  /** Job `id` if present in the raw object, else its `name`, else a positional `#index`. */
  id: string;
  /** Failing zod field path (e.g. `timezone`), or `(root)` when unattributable. */
  field: string;
  /** The validation error message. */
  error: string;
}

/** What the load path reports to the registered notifier. */
export interface CronQuarantineReport {
  /** Newly-quarantined jobs this load (empty on a freeze-only report). */
  quarantined: CronQuarantineEntry[];
  /** Present when a total parse failure froze persistence; names the snapshot (or null if it couldn't be written). */
  frozen?: { snapshotPath: string | null };
}

// ============================================================================
// Storage
// ============================================================================

let cached: CronJobState | null = null;

/**
 * Set true when the persisted file could not be parsed at all (total failure). While set,
 * {@link saveState} refuses to write so the running process never overwrites the corrupt-but-
 * recoverable original. In-memory only and resets to false on process restart (or a
 * {@link clearCronJobsCache}); a still-corrupt file then re-triggers the freeze on the fresh
 * load, so the original is never overwritten across restarts. Within a single process the
 * result is cached, so a repaired file is only re-read after the cache is cleared. Cleared on
 * the next successful full load.
 */
let persistenceFrozen = false;

/**
 * Registered, best-effort owner-notification sink (set by app wiring via
 * {@link setCronQuarantineNotifier}). Kept as an injected callback rather than a static import
 * so `cronJobs.ts` — imported very early — never pulls in the Slack layer (avoids an import cycle).
 * The callback itself is synchronous and fires-and-forgets its async DM internally.
 */
let onQuarantine: ((report: CronQuarantineReport) => void) | null = null;

/** Wire (or clear, with `null`) the owner-notification sink for quarantine/freeze events. */
export function setCronQuarantineNotifier(
  fn: ((report: CronQuarantineReport) => void) | null,
): void {
  onQuarantine = fn;
}

const cronRunZod = z.object({
  executedAt: z.string(),
  status: z.enum(["success", "error", "skipped"]),
  responseTs: z.string().optional(),
  replayOf: z.string().optional(),
});

const skipDateZod = z.object({
  date: z.string(),
  label: z.string(),
});

const cronJobZod = z.object({
  id: z.string(),
  cronExpression: z.string(),
  channel: z.string().optional(),
  prompt: z.string(),
  name: z.string().optional(),
  createdBy: z.string().nullable(),
  systemActor: z.string().optional(),
  createdAt: z.string(),
  enabled: z.boolean(),
  timezone: z.string(),
  oneShot: z.boolean().optional(),
  lastRunAt: z.string().optional(),
  lastRunStatus: z.enum(["success", "error", "skipped"]).optional(),
  requiredTools: z.array(z.string()).optional(),
  plugin: z.string().optional(),
  skipConditions: z.string().optional(),
  // Invalid persisted values coerce to undefined (auto-derivation), tolerating on-disk typos.
  submitResponseMode: z
    .enum(["always", "optional", "optional-post-to", "skipped"])
    .optional()
    .catch(undefined),
  silent: z.boolean().optional().catch(undefined),
  skipDates: z.array(skipDateZod).optional(),
  pluginManaged: z.boolean().optional(),
  specKey: z.string().optional(),
  attachedTopics: z.array(z.string()).optional(),
  attentionLevel: z.enum(["always", "high", "medium", "low"]).optional(),
  jitterMinutes: z.number().optional(),
  runs: z.array(cronRunZod).optional(),
});

// Top-level file gate ONLY — jobs are per-element parsed (below) so one bad job never rejects the
// whole array. `quarantinedJobs` is preserved verbatim, so both arrays are intentionally unknown[].
const cronJobFileZod = z.object({
  jobs: z.array(z.unknown()).optional(),
  quarantinedJobs: z.array(z.unknown()).optional(),
});

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getFilePath(): string {
  return resolve(getStateDir(), "cron-jobs.json");
}

// Permissive label extractor for a quarantined raw object — a non-string/absent id or name
// coerces to undefined rather than throwing, so any shape yields a usable summary.
const quarantineLabelZod = z.object({
  id: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
});

/** Build the owner/Home-Tab summary for a raw job that failed `cronJobZod`. */
function describeQuarantine(raw: unknown, index: number, error: z.ZodError): CronQuarantineEntry {
  const parsed = quarantineLabelZod.safeParse(raw);
  const label = parsed.success ? parsed.data : {};
  const id = label.id || label.name || `#${index}`;
  const issue = error.issues[0];
  return {
    id,
    field: issue && issue.path.length > 0 ? issue.path.join(".") : "(root)",
    error: issue?.message ?? error.message,
  };
}

/**
 * Total parse failure: snapshot the unreadable file and freeze persistence so the running process
 * never overwrites the original. The freeze is set even if the snapshot copy fails.
 */
async function freezeOnTotalFailure(
  filePath: string,
  content: string | null,
  error: unknown,
): Promise<void> {
  persistenceFrozen = true;
  logger.error("cron-jobs: unreadable state file — freezing persistence to protect it:", error);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let snapshotPath: string | null = resolve(
    getStateDir(),
    `cron-jobs.corrupt-${stamp}-${randomUUID().slice(0, 8)}.json`,
  );
  try {
    if (content !== null) {
      await writeFile(snapshotPath, content);
    } else {
      await copyFile(filePath, snapshotPath);
    }
    logger.error(`cron-jobs: corrupt file snapshotted to ${snapshotPath}`);
  } catch (copyErr) {
    logger.error("cron-jobs: failed to write corrupt snapshot (freeze still active):", copyErr);
    snapshotPath = null;
  }

  onQuarantine?.({ quarantined: [], frozen: { snapshotPath } });
}

export async function loadJobs(): Promise<CronJob[]> {
  if (cached) {
    return cached.jobs;
  }

  const filePath = getFilePath();

  if (!(await fileExists(filePath))) {
    cached = { jobs: [] };
    return cached.jobs;
  }

  let content: string | null = null;
  let parsed: z.infer<typeof cronJobFileZod>;
  try {
    content = await readFile(filePath, "utf-8");
    const raw = cronJobFileZod.safeParse(JSON.parse(content));
    if (!raw.success) {
      // Top-level shape unusable — treat like a total failure, not a null-to-empty.
      await freezeOnTotalFailure(filePath, content, raw.error);
      cached = { jobs: [] };
      return cached.jobs;
    }
    parsed = raw.data;
  } catch (error) {
    await freezeOnTotalFailure(filePath, content, error);
    cached = { jobs: [] };
    return cached.jobs;
  }

  const valid: CronJob[] = [];
  const quarantined: unknown[] = [...(parsed.quarantinedJobs ?? [])];
  const newlyQuarantined: CronQuarantineEntry[] = [];
  const rawJobs = parsed.jobs ?? [];
  for (let i = 0; i < rawJobs.length; i++) {
    const result = cronJobZod.safeParse(rawJobs[i]);
    if (result.success) {
      valid.push(result.data);
    } else {
      quarantined.push(rawJobs[i]);
      newlyQuarantined.push(describeQuarantine(rawJobs[i], i, result.error));
    }
  }

  // A successful full parse clears any freeze left by a prior corrupt load.
  persistenceFrozen = false;
  cached = { jobs: valid, ...(quarantined.length > 0 ? { quarantinedJobs: quarantined } : {}) };

  if (newlyQuarantined.length > 0) {
    logger.error(`cron-jobs: quarantined ${newlyQuarantined.length} invalid job(s) — preserved`);
    // Persist the move so the invalid jobs leave the `jobs` array on disk and later loads carry
    // them from `quarantinedJobs` silently — otherwise the owner would be re-DMed on every boot.
    // Best-effort: a write failure must not break loading.
    try {
      await saveState(cached);
    } catch (err) {
      logger.error("cron-jobs: failed to persist quarantine after load:", err);
    }
    onQuarantine?.({ quarantined: newlyQuarantined });
  }
  return cached.jobs;
}

async function saveState(state: CronJobState): Promise<void> {
  if (persistenceFrozen) {
    logger.error("cron-jobs: persistence frozen (corrupt file) — refusing to overwrite on disk");
    return;
  }

  const stateDir = getStateDir();
  const filePath = getFilePath();

  if (!(await fileExists(stateDir))) {
    await mkdir(stateDir, { recursive: true });
  }

  // Round-trip the quarantine on EVERY write. Callers pass only `{ jobs }`, so pull the
  // quarantine from the cache when the caller didn't supply it — otherwise an unrelated save
  // (e.g. plugin reconcile) would drop the quarantined jobs, exactly the 2026-07-06 failure.
  const quarantinedJobs = state.quarantinedJobs ?? cached?.quarantinedJobs ?? [];
  const serialized =
    quarantinedJobs.length > 0 ? { jobs: state.jobs, quarantinedJobs } : { jobs: state.jobs };

  await writeFile(filePath, JSON.stringify(serialized, null, 2));
  cached = { jobs: state.jobs, ...(quarantinedJobs.length > 0 ? { quarantinedJobs } : {}) };
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function getJobs(): Promise<CronJob[]> {
  return loadJobs();
}

export async function getEnabledJobs(): Promise<CronJob[]> {
  const jobs = await loadJobs();
  return jobs.filter((j) => j.enabled);
}

export async function getJob(jobId: string): Promise<CronJob | null> {
  const jobs = await loadJobs();
  return jobs.find((j) => j.id === jobId) ?? null;
}

export async function getJobsByUser(userId: string): Promise<CronJob[]> {
  const jobs = await loadJobs();
  return jobs.filter((j) => j.createdBy === userId);
}

export async function getJobsByChannel(channelId: string): Promise<CronJob[]> {
  const jobs = await loadJobs();
  return jobs.filter((j) => j.channel === channelId);
}

export async function findByPluginOwner(ownerKey: string): Promise<CronJob[]> {
  const jobs = await loadJobs();
  return jobs.filter((j) => j.plugin === ownerKey && j.pluginManaged === true);
}

export interface CreateCronJobParams {
  cronExpression: string;
  /**
   * Optional. When omitted, the resulting job is channelless — delivery is decided
   * at fire time by Claude via `post_to`. See `CronJob.channel` for the contract.
   */
  channel?: string;
  prompt: string;
  /**
   * Short human-readable label for the schedule (1-80 chars). Surfaced in the Home Tab
   * and in tool-call task cards via `{name|id}` interpolation. Required at user-facing
   * boundaries (the `create_scheduled_message` zod schema and the Home Tab edit modal
   * both enforce it). Optional here in the storage layer so plugin reconcile call sites
   * that have not adopted names yet keep compiling — they simply produce nameless jobs.
   */
  name?: string;
  /** Slack user ID, or `null` for system-owned jobs (then `systemActor` must be set). */
  createdBy: string | null;
  /** Required when and only when `createdBy === null`. */
  systemActor?: string;
  timezone: string;
  oneShot?: boolean;
  requiredTools?: string[];
  plugin?: string;
  skipConditions?: string;
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /** When true, the fire suppresses all Slack output. See `CronJob.silent`. */
  silent?: boolean;
  skipDates?: SkipDate[];
  pluginManaged?: boolean;
  specKey?: string;
  /** Topic names to pre-attach when this job fires. See `CronJob.attachedTopics`. */
  attachedTopics?: string[];
  /** Attention level for the session this job creates. See `CronJob.attentionLevel`. */
  attentionLevel?: SettableAttentionLevel;
  /** Forward match-window jitter in minutes. See `CronJob.jitterMinutes`. */
  jitterMinutes?: number;
}

/** Upper bound on `jitterMinutes`; a coarse safety cap (plugins must keep jitter below their cron gap). */
export const MAX_JITTER_MINUTES = 30;

/**
 * Throw if `jitterMinutes` is present but not an integer in `[0, MAX_JITTER_MINUTES]`. Defense in
 * depth: the plugin reconcile path and casual-talk config already validate, so a bad value here is
 * a programmer error.
 */
function assertValidJitter(jitterMinutes: number | null | undefined): void {
  if (jitterMinutes === undefined || jitterMinutes === null) return;
  if (!Number.isInteger(jitterMinutes) || jitterMinutes < 0 || jitterMinutes > MAX_JITTER_MINUTES) {
    throw new Error(
      `createJob: jitterMinutes must be an integer in [0, ${MAX_JITTER_MINUTES}] (got ${jitterMinutes})`,
    );
  }
}

export async function createJob(params: CreateCronJobParams): Promise<CronJob> {
  // Invariant: pluginManaged jobs MUST carry a specKey (the reconcile loop uses it as a stable
  // identity to upsert vs create). Catch plugin-author bugs early — if reconcileCronJobs forgot
  // to set specKey, the resulting job would be orphaned (no way to match it on the next reconcile).
  if (params.pluginManaged && !params.specKey) {
    throw new Error(
      "createJob: pluginManaged jobs must carry a specKey (plugin-author bug — reconcileCronJobs is the supported path for creating plugin-managed jobs)",
    );
  }

  // Actor-identity invariants: createdBy: null ⇔ systemActor is set.
  if (params.createdBy === null && !params.systemActor) {
    throw new Error("createJob: createdBy: null requires a systemActor (e.g. 'plugin:<name>')");
  }
  if (params.createdBy !== null && params.systemActor) {
    throw new Error("createJob: systemActor must not be set when createdBy is a user ID");
  }
  assertValidJitter(params.jitterMinutes);

  const jobs = await loadJobs();
  const job: CronJob = {
    id: randomUUID().slice(0, 12),
    cronExpression: params.cronExpression,
    ...(params.channel !== undefined ? { channel: params.channel } : {}),
    prompt: params.prompt,
    ...(params.name && params.name.trim().length > 0 ? { name: params.name.trim() } : {}),
    createdBy: params.createdBy,
    createdAt: new Date().toISOString(),
    enabled: true,
    timezone: params.timezone,
    ...(params.systemActor ? { systemActor: params.systemActor } : {}),
    ...(params.oneShot && { oneShot: true }),
    ...(params.requiredTools && params.requiredTools.length > 0
      ? { requiredTools: params.requiredTools }
      : {}),
    ...(params.plugin ? { plugin: params.plugin } : {}),
    ...(params.skipConditions ? { skipConditions: params.skipConditions } : {}),
    ...(params.submitResponseMode ? { submitResponseMode: params.submitResponseMode } : {}),
    ...(params.silent ? { silent: true } : {}),
    ...(params.skipDates && params.skipDates.length > 0 ? { skipDates: params.skipDates } : {}),
    ...(params.pluginManaged ? { pluginManaged: true } : {}),
    ...(params.specKey ? { specKey: params.specKey } : {}),
    ...(params.attachedTopics && params.attachedTopics.length > 0
      ? { attachedTopics: params.attachedTopics }
      : {}),
    ...(params.attentionLevel ? { attentionLevel: params.attentionLevel } : {}),
    ...(params.jitterMinutes && params.jitterMinutes > 0
      ? { jitterMinutes: params.jitterMinutes }
      : {}),
  };
  jobs.push(job);
  await saveState({ jobs });
  logger.info(
    `Cron job ${job.id} created${params.channel ? ` for channel ${params.channel}` : " (channelless)"}`,
  );
  return job;
}

export async function toggleJob(jobId: string): Promise<CronJob | null> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  job.enabled = !job.enabled;
  await saveState({ jobs });
  logger.info(`Cron job ${jobId} ${job.enabled ? "enabled" : "disabled"}`);
  return job;
}

export interface UpdateCronJobParams {
  cronExpression?: string;
  /**
   * When `undefined`, the persisted `channel` is unchanged. When `null`, the field is
   * cleared (the job becomes channelless). Otherwise, the new value replaces the
   * persisted one. Plugin reconcile uses `null` when a previously channel-bound spec
   * is re-reconciled without a `channel`.
   */
  channel?: string | null;
  prompt?: string;
  /**
   * When `undefined`, the persisted `name` is unchanged. When empty (after trim), the
   * field is cleared. Otherwise, the new value replaces the persisted one.
   */
  name?: string;
  timezone?: string;
  oneShot?: boolean;
  /** Pass an empty array to clear; undefined leaves the field unchanged. */
  requiredTools?: string[];
  /** Pass empty string to clear; undefined leaves the field unchanged. */
  plugin?: string;
  /** Pass empty string to clear; undefined leaves the field unchanged. */
  skipConditions?: string;
  /**
   * Pass one of the three values to set; pass `null` (or omit explicitly via `submitResponseMode: null`)
   * to clear; leaving undefined keeps the existing value.
   */
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped" | null;
  /** Pass a boolean to set; `null` to clear; undefined leaves the field unchanged. */
  silent?: boolean | null;
  /** Pass an empty array to clear; undefined leaves the field unchanged. */
  skipDates?: SkipDate[];
  /**
   * Pass an empty array to clear; undefined leaves the field unchanged. Pass a non-empty
   * array to overwrite. See `CronJob.attachedTopics`.
   */
  attachedTopics?: string[];
  /** Pass a level to set; `null` to clear; undefined leaves the field unchanged. */
  attentionLevel?: SettableAttentionLevel | null;
  /** Pass minutes to set; `null` or `0` to clear; undefined leaves the field unchanged. */
  jitterMinutes?: number | null;
}

export async function updateJob(
  jobId: string,
  params: UpdateCronJobParams,
): Promise<CronJob | null> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  if (params.cronExpression !== undefined) job.cronExpression = params.cronExpression;
  if (params.channel !== undefined) {
    job.channel = params.channel === null ? undefined : params.channel;
  }
  if (params.prompt !== undefined) job.prompt = params.prompt;
  if (params.name !== undefined) {
    const trimmed = params.name.trim();
    job.name = trimmed.length > 0 ? trimmed : undefined;
  }
  if (params.timezone !== undefined) job.timezone = params.timezone;
  if (params.oneShot !== undefined) job.oneShot = params.oneShot || undefined;
  if (params.requiredTools !== undefined) {
    job.requiredTools = params.requiredTools.length > 0 ? params.requiredTools : undefined;
  }
  if (params.plugin !== undefined) {
    job.plugin = params.plugin.length > 0 ? params.plugin : undefined;
  }
  if (params.skipConditions !== undefined) {
    job.skipConditions = params.skipConditions.length > 0 ? params.skipConditions : undefined;
  }
  if (params.submitResponseMode !== undefined) {
    job.submitResponseMode =
      params.submitResponseMode === null ? undefined : params.submitResponseMode;
  }
  if (params.silent !== undefined) {
    job.silent = params.silent ? true : undefined;
  }
  if (params.skipDates !== undefined) {
    job.skipDates = params.skipDates.length > 0 ? params.skipDates : undefined;
  }
  if (params.attachedTopics !== undefined) {
    job.attachedTopics = params.attachedTopics.length > 0 ? params.attachedTopics : undefined;
  }
  if (params.attentionLevel !== undefined) {
    job.attentionLevel = params.attentionLevel === null ? undefined : params.attentionLevel;
  }
  if (params.jitterMinutes !== undefined) {
    assertValidJitter(params.jitterMinutes);
    job.jitterMinutes =
      params.jitterMinutes === null || params.jitterMinutes === 0
        ? undefined
        : params.jitterMinutes;
  }

  await saveState({ jobs });
  logger.info(`Cron job ${jobId} updated`);
  return job;
}

export async function deleteJob(jobId: string): Promise<boolean> {
  const jobs = await loadJobs();
  const index = jobs.findIndex((j) => j.id === jobId);
  if (index === -1) return false;

  jobs.splice(index, 1);
  await saveState({ jobs });
  logger.info(`Cron job ${jobId} deleted`);
  return true;
}

/**
 * Persist `lastRunAt` at the start of a run, before the work begins. Without this,
 * `lastRunAt` is only written on completion, so a process restart mid-tick would let
 * the post-restart scheduler tick re-fire the same slot. This is the single guard
 * against cross-process double-fires; in-process duplicates are blocked by the
 * `runningJobs` set in the scheduler.
 */
export async function markJobStarted(jobId: string): Promise<void> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return;

  job.lastRunAt = new Date().toISOString();
  await saveState({ jobs });
}

export async function updateJobRunStatus(
  jobId: string,
  status: "success" | "error" | "skipped",
  responseTs?: string,
  replayOf?: string,
): Promise<void> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return;

  const now = new Date().toISOString();
  job.lastRunAt = now;
  job.lastRunStatus = status;

  if (!job.runs) job.runs = [];
  job.runs.push({
    executedAt: now,
    status,
    ...(responseTs ? { responseTs } : {}),
    ...(replayOf ? { replayOf } : {}),
  });

  const maxHistory = getCronMaxRunHistory();
  if (job.runs.length > maxHistory) {
    job.runs.splice(0, job.runs.length - maxHistory);
  }

  await saveState({ jobs });
}

// Clear cache (useful for testing). Also resets the freeze flag, matching a fresh process:
// the next load re-reads the file and re-freezes if it is still corrupt.
export function clearCronJobsCache(): void {
  cached = null;
  persistenceFrozen = false;
}

/** True while persistence is frozen after a total load failure (see {@link freezeOnTotalFailure}). */
export function isCronPersistenceFrozen(): boolean {
  return persistenceFrozen;
}

/** A quarantined job summary keyed by its stable positional `index` (the action-button value). */
export type CronQuarantineSummary = CronQuarantineEntry & { index: number };

/** Quarantined jobs as displayable summaries, each keyed by its stable positional `index`. */
export async function getQuarantinedJobSummaries(): Promise<CronQuarantineSummary[]> {
  await loadJobs();
  const quarantined = cached?.quarantinedJobs ?? [];
  return quarantined.map((raw, index) => {
    const result = cronJobZod.safeParse(raw);
    if (result.success) {
      // A quarantined raw that now validates (schema loosened / hand-repaired) — still parked here
      // until an admin clicks Retry, so surface it clearly rather than as a phantom error.
      const label = quarantineLabelZod.safeParse(raw);
      const id = (label.success ? label.data.id || label.data.name : undefined) || `#${index}`;
      return { index, id, field: "—", error: "revalidated — click Retry to restore" };
    }
    return { index, ...describeQuarantine(raw, index, result.error) };
  });
}

/**
 * Re-validate a quarantined job (after a hand-repair or a loosened schema). On success it moves
 * from `quarantinedJobs` into the live `jobs` and is persisted; on failure it stays quarantined
 * and the current error is returned. The in-memory move only commits once `saveState` succeeds.
 */
export async function retryQuarantinedJob(index: number): Promise<{ ok: boolean; error?: string }> {
  await loadJobs();
  const quarantined = cached?.quarantinedJobs ?? [];
  if (index < 0 || index >= quarantined.length) return { ok: false, error: "not found" };

  const result = cronJobZod.safeParse(quarantined[index]);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: issue?.message ?? result.error.message };
  }

  const remaining = quarantined.filter((_, i) => i !== index);
  try {
    await saveState({ jobs: [...(cached?.jobs ?? []), result.data], quarantinedJobs: remaining });
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  logger.info(`cron-jobs: quarantined job ${result.data.id} re-validated and restored`);
  return { ok: true };
}

/** Explicit, owner/admin-gated removal — the ONLY path that drops a quarantined job. */
export async function deleteQuarantinedJob(index: number): Promise<boolean> {
  await loadJobs();
  const quarantined = cached?.quarantinedJobs ?? [];
  if (index < 0 || index >= quarantined.length) return false;

  const remaining = quarantined.filter((_, i) => i !== index);
  try {
    await saveState({ jobs: cached?.jobs ?? [], quarantinedJobs: remaining });
  } catch (err) {
    logger.error(`cron-jobs: failed to remove quarantined job #${index}:`, err);
    return false;
  }
  logger.info(`cron-jobs: quarantined job #${index} removed by explicit action`);
  return true;
}

/**
 * Synchronous lookup against the in-memory cron-jobs cache. Returns `null` when the cache
 * is cold (no `loadJobs()` call has populated it yet) or when no job matches the given id.
 * Intended for tight-loop callers that cannot tolerate async I/O — notably the streaming
 * tool-label enricher, which needs to surface a job's `name` on every tool_use event.
 */
export function getJobByIdFromCache(id: string): CronJob | null {
  if (!cached) return null;
  return cached.jobs.find((j) => j.id === id) ?? null;
}

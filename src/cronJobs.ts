import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import { getCronMaxRunHistory } from "./config.js";

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
  channel: string;
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
   * - `"skipped"` — the entire schema is replaced by `{ skip_response: z.literal(true) }`; the
   *   run MUST decline delivery. Use when the run's actual deliverable is produced by another
   *   required tool (e.g. trivia's `post_questions`) and `submit_response` is purely a
   *   run terminator.
   *
   * When unset, today's auto-derivation rules apply unchanged. See the `submit-response-mode`
   * capability for the full resolution table.
   */
  submitResponseMode?: "always" | "optional" | "skipped";
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
   * Recent execution history (most recent last). Capped by
   * `config.scheduledMessagesMaxRunHistory` (default 50); older entries are
   * dropped from the front when {@link updateJobRunStatus} records a new run.
   */
  runs?: CronRun[];
}

interface CronJobState {
  jobs: CronJob[];
}

// ============================================================================
// Storage
// ============================================================================

const DEFAULT_STATE: CronJobState = { jobs: [] };

let cached: CronJobState | null = null;

const VALID_SUBMIT_RESPONSE_MODES = new Set(["always", "optional", "skipped"]);

/**
 * Drop `submitResponseMode` from jobs whose persisted value isn't one of the three valid
 * strings. Logs a warning identifying the offending row(s). Other fields are trusted.
 */
function sanitizeLoadedJobs(jobs: CronJob[]): CronJob[] {
  for (const job of jobs) {
    if (
      job.submitResponseMode !== undefined &&
      !VALID_SUBMIT_RESPONSE_MODES.has(job.submitResponseMode)
    ) {
      logger.warn(
        `Cron job ${job.id}: ignoring invalid submitResponseMode "${job.submitResponseMode}" (expected one of: always, optional, skipped). Falling back to auto-derivation.`,
      );
      job.submitResponseMode = undefined;
    }
  }
  return jobs;
}

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getFilePath(): string {
  return resolve(getStateDir(), "cron-jobs.json");
}

export async function loadJobs(): Promise<CronJob[]> {
  if (cached) {
    return cached.jobs;
  }

  const filePath = getFilePath();

  if (!(await fileExists(filePath))) {
    cached = { ...DEFAULT_STATE, jobs: [] };
    return cached.jobs;
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<CronJobState>;
    cached = { jobs: sanitizeLoadedJobs(parsed.jobs ?? []) };
    return cached.jobs;
  } catch (error) {
    logger.error("Failed to load cron jobs:", error);
    cached = { ...DEFAULT_STATE, jobs: [] };
    return cached.jobs;
  }
}

async function saveState(state: CronJobState): Promise<void> {
  const stateDir = getStateDir();
  const filePath = getFilePath();

  if (!(await fileExists(stateDir))) {
    await mkdir(stateDir, { recursive: true });
  }

  await writeFile(filePath, JSON.stringify(state, null, 2));
  cached = state;
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
  channel: string;
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
  submitResponseMode?: "always" | "optional" | "skipped";
  skipDates?: SkipDate[];
  pluginManaged?: boolean;
  specKey?: string;
  /** Topic names to pre-attach when this job fires. See `CronJob.attachedTopics`. */
  attachedTopics?: string[];
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

  const jobs = await loadJobs();
  const job: CronJob = {
    id: randomUUID().slice(0, 12),
    cronExpression: params.cronExpression,
    channel: params.channel,
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
    ...(params.skipDates && params.skipDates.length > 0 ? { skipDates: params.skipDates } : {}),
    ...(params.pluginManaged ? { pluginManaged: true } : {}),
    ...(params.specKey ? { specKey: params.specKey } : {}),
    ...(params.attachedTopics && params.attachedTopics.length > 0
      ? { attachedTopics: params.attachedTopics }
      : {}),
  };
  jobs.push(job);
  await saveState({ jobs });
  logger.info(`Cron job ${job.id} created for channel ${params.channel}`);
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
  channel?: string;
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
  submitResponseMode?: "always" | "optional" | "skipped" | null;
  /** Pass an empty array to clear; undefined leaves the field unchanged. */
  skipDates?: SkipDate[];
  /**
   * Pass an empty array to clear; undefined leaves the field unchanged. Pass a non-empty
   * array to overwrite. See `CronJob.attachedTopics`.
   */
  attachedTopics?: string[];
}

export async function updateJob(
  jobId: string,
  params: UpdateCronJobParams,
): Promise<CronJob | null> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  if (params.cronExpression !== undefined) job.cronExpression = params.cronExpression;
  if (params.channel !== undefined) job.channel = params.channel;
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
  if (params.skipDates !== undefined) {
    job.skipDates = params.skipDates.length > 0 ? params.skipDates : undefined;
  }
  if (params.attachedTopics !== undefined) {
    job.attachedTopics = params.attachedTopics.length > 0 ? params.attachedTopics : undefined;
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

// Clear cache (useful for testing)
export function clearCronJobsCache(): void {
  cached = null;
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

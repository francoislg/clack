import { CronExpressionParser } from "cron-parser";
import type { App } from "@slack/bolt";
import {
  getEnabledJobs,
  markJobStarted,
  updateJobRunStatus,
  deleteJob,
  getJobByIdFromCache,
  type CronJob,
  type SkipDate,
} from "./cronJobs.js";
import { processMessage } from "./slack/handlers/core.js";
import { findSessionByMessage } from "./sessions.js";
import { logger } from "./logger.js";
import { getConfig } from "./config.js";
import { registerArgEnricher, type ToolArgs } from "./streaming/toolMappingLoader.js";
import { resolveChannelLabel, slackLink } from "./slack/logContext.js";
import { openDmChannel } from "./slack/channelResolver.js";
import { unfurlOptions } from "./slack/unfurlOptions.js";
import { errorMessage as toErrorMessage } from "./errors.js";
import { isSlackAccessError } from "./slackErrors.js";
import { humanReadableSchedule } from "./cronFormatter.js";
import { resolveJobActor, actorDmTarget, actorDisplay, type Actor } from "./actor.js";
import { loadRoles } from "./roles.js";
import { makeChannellessChannelId } from "./channelless.js";

// ============================================================================
// Injectable deps (for tests; production uses module-level imports)
// ============================================================================

export interface CronSchedulerDeps {
  processMessage: typeof processMessage;
  markJobStarted: typeof markJobStarted;
  updateJobRunStatus: typeof updateJobRunStatus;
  deleteJob: typeof deleteJob;
  notifyCreatorOfError: (
    job: CronJob,
    client: App["client"],
    errorMessage: string,
  ) => Promise<void>;
}

// ============================================================================
// State
// ============================================================================

let tickInterval: ReturnType<typeof setInterval> | null = null;
const runningJobs = new Set<string>();

let slackClient: App["client"] | null = null;

// ============================================================================
// Scheduler Lifecycle
// ============================================================================

export function startCronScheduler(client: App["client"]): void {
  if (tickInterval) {
    clearInterval(tickInterval);
  }
  slackClient = client;
  registerCronNameEnrichers();
  tickInterval = setInterval(tick, 60_000);
  logger.info("Cron scheduler started (60s tick)");
}

// Tools whose only identity is `id` but whose task-card template uses `{name|id}`.
// The streamer never sees a `name` arg on these calls — registering a tiny enricher
// for each one lets the in-memory cron-jobs cache supply it.
const CRON_LOOKUP_TOOLS = [
  "mcp__clack__cancel_scheduled_message",
  "mcp__clack__update_scheduled_message",
  "mcp__clack__run_scheduled_message_now",
  "mcp__clack__get_scheduled_message_runs",
];

function cronNameEnricher(args: ToolArgs): ToolArgs {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) return args;
  const job = getJobByIdFromCache(id);
  if (!job?.name) return args;
  return { ...args, name: job.name };
}

function registerCronNameEnrichers(): void {
  for (const toolName of CRON_LOOKUP_TOOLS) {
    registerArgEnricher(toolName, cronNameEnricher);
  }
}

export function stopCronScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  slackClient = null;
  logger.info("Cron scheduler stopped");
}

// ============================================================================
// Tick
// ============================================================================

async function tick(): Promise<void> {
  let jobs: CronJob[];
  try {
    jobs = await getEnabledJobs();
  } catch (error) {
    logger.error("Cron scheduler: failed to load jobs", error);
    return;
  }

  if (jobs.length === 0) return;

  const now = new Date();
  // User-job filter: when user-facing scheduling is disabled, the scheduler still ticks
  // (plugin crons keep firing) but persisted user-created jobs are skipped at match time.
  // See {@link shouldSkipUserJob}.
  let userSchedulesEnabled = true;
  try {
    userSchedulesEnabled = getConfig().cron?.userSchedules === true;
  } catch {
    // Config not loaded yet — leave default true so we don't drop jobs during a window
    // where the scheduler somehow ticked before config.load(). In practice unreachable.
  }

  for (const job of jobs) {
    if (runningJobs.has(job.id)) {
      logger.debug(`Cron job ${job.id} still running, skipping`);
      continue;
    }

    if (shouldSkipUserJob(job, userSchedulesEnabled)) {
      // User-created job and the user-tools gate is off. Silently skip without recording
      // a run; the job is preserved so re-enabling the gate restores its cadence.
      continue;
    }

    if (
      matchesCron(job.cronExpression, now, job.timezone, {
        lastRunAt: job.lastRunAt,
        jobId: job.id,
        jitterMinutes: job.jitterMinutes,
      })
    ) {
      if (!slackClient) {
        logger.error(`Cron job ${job.id}: no Slack client available`);
        continue;
      }
      // Fire and forget — errors handled inside executeJob
      executeJob(job, slackClient).catch((error) => {
        logger.error(`Cron job ${job.id} unexpected error:`, error);
      });
    }
  }
}

/**
 * Decide whether the tick loop should skip a job because the user-facing scheduling
 * gate is off. User-created jobs (`createdBy` is a non-null user ID) are skipped;
 * plugin-managed jobs (`createdBy === null`) always proceed. When the gate is on,
 * every job proceeds regardless of `createdBy`.
 */
export function shouldSkipUserJob(job: CronJob, userSchedulesEnabled: boolean): boolean {
  if (userSchedulesEnabled) return false;
  return job.createdBy !== null;
}

// ============================================================================
// Cron Matching
// ============================================================================

/**
 * Deterministic forward offset (in ms) applied to a job's canonical cron slot when
 * `jitterMinutes` is set. Seeded on `jobId` + the canonical slot's ISO string so every tick
 * within one occurrence computes the same value (the 60s poll then matches exactly one tick),
 * while distinct occurrences vary. Returns `0` for any non-finite or non-positive jitter. Uses a
 * FNV-1a 32-bit hash — distribution quality matters, not cryptographic strength.
 */
export function seededOffsetMs(jobId: string, prev: Date, jitterMinutes: number): number {
  if (!Number.isFinite(jitterMinutes) || jitterMinutes <= 0) return 0;
  let h = 0x811c9dc5;
  const seed = `${jobId}|${prev.toISOString()}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % (jitterMinutes * 60_000);
}

export interface MatchesCronOptions {
  lastRunAt?: string;
  /** Required alongside `jitterMinutes` for jitter to apply — seeds the per-occurrence offset. */
  jobId?: string;
  jitterMinutes?: number;
}

// The cron expression stays canonical for inspection / Home Tab description; `jitterMinutes`
// only shifts the match window forward via `seededOffsetMs`.
export function matchesCron(
  expression: string,
  now: Date,
  timezone: string,
  { lastRunAt, jobId, jitterMinutes }: MatchesCronOptions = {},
): boolean {
  try {
    const interval = CronExpressionParser.parse(expression, {
      currentDate: now,
      tz: timezone,
    });

    // Shift the canonical slot forward by the deterministic per-occurrence jitter offset, then
    // check whether `now` falls within the 60-second window after the (possibly shifted) slot.
    const prev = interval.prev().toDate();
    const offsetMs = jobId && jitterMinutes ? seededOffsetMs(jobId, prev, jitterMinutes) : 0;
    const effectivePrev = prev.getTime() + offsetMs;
    const diffMs = now.getTime() - effectivePrev;
    if (diffMs < 0 || diffMs >= 60_000) return false;

    // Guard against double-fire: if this (jittered) cron time was already handled, skip it.
    // setInterval can drift slightly, causing two consecutive ticks to both fall
    // within the same 60-second matching window.
    if (lastRunAt) {
      const lastRun = new Date(lastRunAt).getTime();
      if (effectivePrev <= lastRun) return false;
    }

    return true;
  } catch (error) {
    logger.error(`Invalid cron expression "${expression}":`, error);
    return false;
  }
}

// ============================================================================
// Skip-Date Matching
// ============================================================================

/**
 * Format `now` in `timezone` using `en-CA` (which emits `YYYY-MM-DD`), then return the
 * `YYYY-MM-DD` and `MM-DD` slices used for skip-date comparison.
 */
function dateKeysInTimezone(now: Date, timezone: string): { ymd: string; md: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = formatter.format(now);
  return { ymd, md: ymd.slice(5) };
}

/**
 * Return the first {@link SkipDate} entry that matches `now` in `timezone`, or `null` if no
 * entry matches. An entry's `date` matches when it equals today's `YYYY-MM-DD` (exact) or
 * today's `MM-DD` (recurring annually). First match wins; callers use the returned entry's
 * `label` for logging.
 */
export function matchesSkipDate(
  entries: SkipDate[] | undefined,
  now: Date,
  timezone: string,
): SkipDate | null {
  if (!entries || entries.length === 0) return null;
  let keys: { ymd: string; md: string };
  try {
    keys = dateKeysInTimezone(now, timezone);
  } catch (error) {
    logger.error(`Invalid timezone "${timezone}" when evaluating skipDates:`, error);
    return null;
  }
  for (const entry of entries) {
    if (entry.date === keys.ymd || entry.date === keys.md) return entry;
  }
  return null;
}

// ============================================================================
// Job Execution
// ============================================================================

const defaultDeps: CronSchedulerDeps = {
  processMessage,
  markJobStarted,
  updateJobRunStatus,
  deleteJob,
  notifyCreatorOfError,
};

export async function executeJob(
  job: CronJob,
  client: App["client"],
  deps: CronSchedulerDeps = defaultDeps,
  asOf?: Date,
): Promise<void> {
  runningJobs.add(job.id);
  if (job.channel !== undefined) {
    const channelLabel = await resolveChannelLabel(client, job.channel);
    logger.info(
      `Cron job ${job.id} executing in ${channelLabel}${await slackLink(client, job.channel)}`,
    );
  } else {
    logger.info(`Cron job ${job.id} executing (channelless — destination decided by Claude)`);
  }
  const replayOf = asOf?.toISOString();

  try {
    // Deterministic skip-date gate. Evaluated before opening a Claude session so off-days
    // cost nothing and cannot be misinterpreted by the model. Composes with `skipConditions`
    // (which still runs inside `executeDynamicJob` when no skipDates entry matches).
    const skipMatch = matchesSkipDate(job.skipDates, asOf ?? new Date(), job.timezone);
    if (skipMatch) {
      await deps.updateJobRunStatus(job.id, "skipped", undefined, replayOf);
      logger.info(`Cron job ${job.id} skipped by skipDates (${skipMatch.label})`);
      if (job.oneShot) {
        await deps.deleteJob(job.id);
        logger.info(`Cron job ${job.id} deleted (one-shot)`);
      }
      return;
    }

    // Persist the slot as fired BEFORE running, so a process restart mid-execution
    // doesn't cause the post-restart tick to re-fire the same cron slot.
    await deps.markJobStarted(job.id);

    const outcome = await executeDynamicJob(job, client, deps, asOf);

    if (outcome.skipped) {
      await deps.updateJobRunStatus(job.id, "skipped", undefined, replayOf);
      logger.info(`Cron job ${job.id} skipped by Claude (skipConditions matched)`);
    } else {
      await deps.updateJobRunStatus(job.id, "success", outcome.responseTs, replayOf);
    }

    if (job.oneShot) {
      await deps.deleteJob(job.id);
      logger.info(`Cron job ${job.id} deleted (one-shot)`);
    }
  } catch (error) {
    logger.error(`Cron job ${job.id} failed:`, error);
    try {
      await deps.updateJobRunStatus(job.id, "error", undefined, replayOf);
    } catch (e) {
      logger.error("Failed to update job status:", e);
    }
    // Errors caught here are unhandled by executeAndDeliver (e.g. delivery
    // failures like channel_not_found). Handled Claude errors don't throw, so
    // they take their own DM-report path and never reach this catch — meaning
    // notifying here can't double-notify.
    try {
      await deps.notifyCreatorOfError(job, client, toErrorMessage(error));
    } catch (e) {
      logger.error("Failed to notify creator:", e);
    }
  } finally {
    runningJobs.delete(job.id);
  }
}

export async function runJobNow(
  job: CronJob,
  client: App["client"],
  asOf?: Date,
): Promise<JobOutcome> {
  if (job.channel !== undefined) {
    const channelLabel = await resolveChannelLabel(client, job.channel);
    logger.info(
      `Cron job ${job.id} executing manually in ${channelLabel}${await slackLink(client, job.channel)}`,
    );
  } else {
    logger.info(`Cron job ${job.id} executing manually (channelless)`);
  }
  const replayOf = asOf?.toISOString();
  const outcome = await executeDynamicJob(job, client, defaultDeps, asOf);
  if (outcome.skipped) {
    await updateJobRunStatus(job.id, "skipped", undefined, replayOf);
  } else {
    await updateJobRunStatus(job.id, "success", outcome.responseTs, replayOf);
  }
  return outcome;
}

export interface JobOutcome {
  skipped: boolean;
  responseTs?: string;
}

export async function executeDynamicJob(
  job: CronJob,
  client: App["client"],
  deps: CronSchedulerDeps,
  asOf?: Date,
): Promise<JobOutcome> {
  const messageTs = `${Date.now() / 1000}`;
  const actor = await resolveJobActor(job);
  // System actors have no real Slack userId; the systemActor source doubles
  // as a stable identifier for session lookups and trigger metadata.
  const effectiveUserId = actor.kind === "user" ? actor.userId : actor.source;

  // Channelless cron jobs (no `job.channel`) synthesize a `channelless:<jobId>` sentinel
  // for the dispatch boundary. The session stores the sentinel, and the submit_response
  // schema selector forces the "optional-post-to" shape (skip OR post_to, no primary).
  // Slack API call sites guard against the sentinel via `isChannellessChannelId`.
  const dispatchChannelId = job.channel ?? makeChannellessChannelId(job.id);
  const response = await deps.processMessage({
    client,
    userId: effectiveUserId,
    channelId: dispatchChannelId,
    messageTs,
    messageText: job.prompt,
    triggerType: "scheduled",
    silentThinking: true,
    additionalSystemPrompt: await buildAdditionalSystemPrompt(job, asOf),
    requiredTools: job.requiredTools,
    skipConditions: job.skipConditions,
    submitResponseMode: job.submitResponseMode,
    jobId: job.id,
    roleOverride: actor.kind === "system" ? "system" : undefined,
    asOf,
    preAttachedTopics: job.attachedTopics,
    attentionLevel: job.attentionLevel,
  });

  if (response.skipped) {
    return { skipped: true };
  }

  // Read back the session to capture the Slack message timestamp. For channelless
  // jobs the lookup key is the synthesized sentinel — the session was stored under
  // the same value, so this still finds the right record.
  const session = await findSessionByMessage(dispatchChannelId, messageTs, effectiveUserId);
  return { skipped: false, responseTs: session?.responseTs };
}

async function buildAdditionalSystemPrompt(job: CronJob, asOf?: Date): Promise<string> {
  const attribution = await buildAttribution(job);
  if (!asOf) return attribution;
  const iso = asOf.toISOString();
  const replayContext = [
    "",
    "",
    "REPLAY CONTEXT: This run is replaying a scheduled fire that was originally due " +
      `at ${iso}. When interpreting relative date language ("today", "yesterday", "this week", ` +
      '"last 24 hours", etc.) or when filtering by relative dates in tool calls, treat the ' +
      `effective current date as ${iso} — NOT the wall-clock time shown in CURRENT DATE. ` +
      "Note that the underlying tools still see real wall-clock time; you must translate " +
      "relative date phrases into explicit dates anchored on the replay timestamp before " +
      "passing them as tool arguments.",
  ].join("\n");
  return attribution + replayContext;
}

// ============================================================================
// Attribution
// ============================================================================

async function buildAttribution(job: CronJob): Promise<string> {
  const schedule = humanReadableSchedule(job.cronExpression, job.timezone);
  const actor = await resolveJobActor(job);
  return `_Scheduled by ${actorDisplay(actor)} · ${schedule}_`;
}

// ============================================================================
// Error Notification
// ============================================================================

export interface NotifyErrorDeps {
  loadRoles: typeof loadRoles;
}

const defaultNotifyDeps: NotifyErrorDeps = { loadRoles };

export async function notifyCreatorOfError(
  job: CronJob,
  client: App["client"],
  errorMessage: string,
  deps: NotifyErrorDeps = defaultNotifyDeps,
  options: { suppressUnfurls?: boolean } = {},
): Promise<void> {
  const actor = await resolveJobActor(job);
  const dmTarget = await resolveErrorDmTarget(actor, deps);
  if (!dmTarget) {
    logger.error(
      `Cron job ${job.id} (${actorDisplay(actor)}) failed and no DM target is available: ${errorMessage}`,
    );
    return;
  }

  const dmChannelId = await openDmChannel(client, dmTarget.userId);
  if (!dmChannelId) return;

  try {
    const schedule = humanReadableSchedule(job.cronExpression, job.timezone);
    const text =
      dmTarget.audience === "creator"
        ? buildCreatorErrorText(job, schedule, errorMessage)
        : buildOwnerErrorText(job, actor, schedule, errorMessage);
    await client.chat.postMessage({
      channel: dmChannelId,
      text,
      ...unfurlOptions(options.suppressUnfurls),
    });
  } catch (dmError) {
    logger.error(`Failed to DM ${dmTarget.userId} about cron error:`, dmError);
  }
}

/**
 * Pick the human Slack user to notify about a cron failure.
 * - User-created jobs DM the creator.
 * - System jobs escalate to the deployment owner (read from `roles.json`).
 * Returns null when no DM target can be resolved (e.g. system job with no owner).
 */
async function resolveErrorDmTarget(
  actor: Actor,
  deps: NotifyErrorDeps,
): Promise<{ userId: string; audience: "creator" | "owner" } | null> {
  const direct = actorDmTarget(actor);
  if (direct !== null) return { userId: direct, audience: "creator" };
  const roles = await deps.loadRoles();
  if (!roles.owner) return null;
  return { userId: roles.owner, audience: "owner" };
}

function buildOwnerErrorText(
  job: CronJob,
  actor: Actor,
  schedule: string,
  errorMessage: string,
): string {
  const isDmTarget = job.channel !== undefined && job.channel.startsWith("D");
  let target: string;
  if (job.channel === undefined) {
    target = "(channelless — destination decided at fire time)";
  } else if (isDmTarget) {
    target = `the DM channel \`${job.channel}\``;
  } else {
    target = `<#${job.channel}>`;
  }
  const source = actor.kind === "system" ? actor.source : "unknown";
  const specLabel = job.specKey ? ` (\`${job.specKey}\`)` : "";

  return (
    `⚠️ A system-owned scheduled job from \`${source}\`${specLabel} to ${target} (${schedule}) failed:\n` +
    `\`\`\`${errorMessage}\`\`\`\n` +
    `It will try again at the next scheduled time.`
  );
}

function buildCreatorErrorText(job: CronJob, schedule: string, errorMessage: string): string {
  // User-created jobs always have a channel — channelless jobs are plugin-managed
  // and use the owner-error path. Match the owner-error fallback wording in the
  // unreachable case so the two paths stay consistent if invariants ever shift.
  const isDmTarget = job.channel !== undefined && job.channel.startsWith("D");
  let target: string;
  if (job.channel === undefined) {
    target = "(channelless — destination decided at fire time)";
  } else if (isDmTarget) {
    target = `the DM channel \`${job.channel}\``;
  } else {
    target = `<#${job.channel}>`;
  }

  if (isSlackAccessError(errorMessage)) {
    if (isDmTarget) {
      return (
        `⚠️ Your scheduled message (${schedule}) failed because Clack can't access ${target}. ` +
        `This usually means it's a DM Clack isn't part of. Update the schedule to target a ` +
        `channel Clack is in, or recreate it. It will try again at the next scheduled time.`
      );
    }
    return (
      `⚠️ Your scheduled message to ${target} (${schedule}) failed because Clack isn't a ` +
      `member of the channel. Invite it with \`/invite @Clack\` and the next run will succeed.`
    );
  }

  return (
    `⚠️ Your scheduled message to ${target} (${schedule}) failed:\n` +
    `\`\`\`${errorMessage}\`\`\`\n` +
    `It will try again at the next scheduled time.`
  );
}

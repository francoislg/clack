import { CronExpressionParser } from "cron-parser";
import type { App } from "@slack/bolt";
import {
  getEnabledJobs,
  updateJobRunStatus,
  deleteJob,
  type CronJob,
  type SkipDate,
} from "./cronJobs.js";
import { processMessage } from "./slack/handlers/core.js";
import { findSessionByMessage } from "./sessions.js";
import { logger } from "./logger.js";
import { resolveChannelLabel, slackLink } from "./slack/logContext.js";
import { openDmChannel } from "./slack/channelResolver.js";
import { unfurlOptions } from "./slack/unfurlOptions.js";
import { errorMessage as toErrorMessage } from "./errors.js";
import { isSlackAccessError } from "./slackErrors.js";
import { humanReadableSchedule } from "./cronFormatter.js";
import { resolveJobActor, actorDmTarget, actorDisplay, type Actor } from "./actor.js";
import { loadRoles } from "./roles.js";

// ============================================================================
// Injectable deps (for tests; production uses module-level imports)
// ============================================================================

export interface CronSchedulerDeps {
  processMessage: typeof processMessage;
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
  tickInterval = setInterval(tick, 60_000);
  logger.info("Cron scheduler started (60s tick)");
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

  for (const job of jobs) {
    if (runningJobs.has(job.id)) {
      logger.debug(`Cron job ${job.id} still running, skipping`);
      continue;
    }

    if (matchesCron(job.cronExpression, now, job.timezone, job.lastRunAt)) {
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

// ============================================================================
// Cron Matching
// ============================================================================

export function matchesCron(
  expression: string,
  now: Date,
  timezone: string,
  lastRunAt?: string,
): boolean {
  try {
    const interval = CronExpressionParser.parse(expression, {
      currentDate: now,
      tz: timezone,
    });

    // Get the previous scheduled time and check if it falls within the current minute
    const prev = interval.prev().toDate();
    const diffMs = now.getTime() - prev.getTime();
    if (diffMs < 0 || diffMs >= 60_000) return false;

    // Guard against double-fire: if this cron time was already handled, skip it.
    // setInterval can drift slightly, causing two consecutive ticks to both fall
    // within the same 60-second matching window.
    if (lastRunAt) {
      const lastRun = new Date(lastRunAt).getTime();
      if (prev.getTime() <= lastRun) return false;
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
  const channelLabel = await resolveChannelLabel(client, job.channel);
  logger.info(
    `Cron job ${job.id} executing in ${channelLabel}${await slackLink(client, job.channel)}`,
  );
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
  const channelLabel = await resolveChannelLabel(client, job.channel);
  logger.info(
    `Cron job ${job.id} executing manually in ${channelLabel}${await slackLink(client, job.channel)}`,
  );
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

  const response = await deps.processMessage({
    client,
    userId: effectiveUserId,
    channelId: job.channel,
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
  });

  if (response.skipped) {
    return { skipped: true };
  }

  // Read back the session to capture the Slack message timestamp
  const session = await findSessionByMessage(job.channel, messageTs, effectiveUserId);
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
  const isDmTarget = job.channel.startsWith("D");
  const target = isDmTarget ? `the DM channel \`${job.channel}\`` : `<#${job.channel}>`;
  const source = actor.kind === "system" ? actor.source : "unknown";
  const specLabel = job.specKey ? ` (\`${job.specKey}\`)` : "";

  return (
    `⚠️ A system-owned scheduled job from \`${source}\`${specLabel} to ${target} (${schedule}) failed:\n` +
    `\`\`\`${errorMessage}\`\`\`\n` +
    `It will try again at the next scheduled time.`
  );
}

function buildCreatorErrorText(job: CronJob, schedule: string, errorMessage: string): string {
  const isDmTarget = job.channel.startsWith("D");
  const target = isDmTarget ? `the DM channel \`${job.channel}\`` : `<#${job.channel}>`;

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

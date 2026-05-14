import { CronExpressionParser } from "cron-parser";
import type { App } from "@slack/bolt";
import { getEnabledJobs, updateJobRunStatus, deleteJob, type CronJob } from "./cronJobs.js";
import { processMessage } from "./slack/handlers/core.js";
import { findSessionByMessage } from "./sessions.js";
import { logger } from "./logger.js";
import { resolveChannelLabel, slackLink } from "./slack/logContext.js";
import { openDmChannel } from "./slack/channelResolver.js";
import { errorMessage as toErrorMessage } from "./errors.js";
import { isSlackAccessError } from "./slackErrors.js";
import { humanReadableSchedule } from "./cronFormatter.js";

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

  const response = await deps.processMessage({
    client,
    userId: job.createdBy,
    channelId: job.channel,
    messageTs,
    messageText: job.prompt,
    triggerType: "scheduled",
    silentThinking: true,
    additionalSystemPrompt: buildAdditionalSystemPrompt(job, asOf),
    requiredTools: job.requiredTools,
    skipConditions: job.skipConditions,
    jobId: job.id,
  });

  if (response.skipped) {
    return { skipped: true };
  }

  // Read back the session to capture the Slack message timestamp
  const session = await findSessionByMessage(job.channel, messageTs, job.createdBy);
  return { skipped: false, responseTs: session?.responseTs };
}

function buildAdditionalSystemPrompt(job: CronJob, asOf?: Date): string {
  const attribution = buildAttribution(job);
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

function buildAttribution(job: CronJob): string {
  const schedule = humanReadableSchedule(job.cronExpression, job.timezone);
  return `_Scheduled by <@${job.createdBy}> · ${schedule}_`;
}

// ============================================================================
// Error Notification
// ============================================================================

export async function notifyCreatorOfError(
  job: CronJob,
  client: App["client"],
  errorMessage: string,
): Promise<void> {
  const dmChannelId = await openDmChannel(client, job.createdBy);
  if (!dmChannelId) return;

  try {
    const schedule = humanReadableSchedule(job.cronExpression, job.timezone);
    const text = buildCreatorErrorText(job, schedule, errorMessage);
    await client.chat.postMessage({ channel: dmChannelId, text });
  } catch (dmError) {
    logger.error(`Failed to DM creator ${job.createdBy} about cron error:`, dmError);
  }
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

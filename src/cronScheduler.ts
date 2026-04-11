import { CronExpressionParser } from "cron-parser";
import type { App } from "@slack/bolt";
import { getEnabledJobs, updateJobRunStatus, deleteJob, type CronJob } from "./cronJobs.js";
import { processMessage } from "./slack/handlers/core.js";
import { logger } from "./logger.js";
import { resolveChannelLabel, slackLink } from "./slack/logContext.js";
import { openDmChannel } from "./slack/channelResolver.js";
import { errorMessage as toErrorMessage } from "./errors.js";

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
      // Fire and forget — errors handled inside executeJob
      executeJob(job).catch((error) => {
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

async function executeJob(job: CronJob): Promise<void> {
  if (!slackClient) {
    logger.error(`Cron job ${job.id}: no Slack client available`);
    return;
  }

  runningJobs.add(job.id);
  const channelLabel = slackClient
    ? await resolveChannelLabel(slackClient, job.channel)
    : job.channel;
  logger.info(
    `Cron job ${job.id} executing in ${channelLabel}${await slackLink(slackClient, job.channel)}`,
  );

  try {
    await executeDynamicJob(job, slackClient);

    await updateJobRunStatus(job.id, "success");

    if (job.oneShot) {
      await deleteJob(job.id);
      logger.info(`Cron job ${job.id} deleted (one-shot)`);
    }
  } catch (error) {
    logger.error(`Cron job ${job.id} failed:`, error);
    try {
      await updateJobRunStatus(job.id, "error");
    } catch (e) {
      logger.error("Failed to update job status:", e);
    }
    // Dynamic jobs already notify via handleError in silentThinking mode; only notify here for static jobs
    if (!job.prompt) {
      try {
        await notifyCreatorOfError(job, slackClient, toErrorMessage(error));
      } catch (e) {
        logger.error("Failed to notify creator:", e);
      }
    }
  } finally {
    runningJobs.delete(job.id);
  }
}

export async function runJobNow(job: CronJob, client: App["client"]): Promise<void> {
  const channelLabel = await resolveChannelLabel(client, job.channel);
  logger.info(
    `Cron job ${job.id} executing manually in ${channelLabel}${await slackLink(client, job.channel)}`,
  );
  await executeDynamicJob(job, client);
}

async function executeDynamicJob(job: CronJob, client: App["client"]): Promise<void> {
  const messageTs = `${Date.now() / 1000}`;

  await processMessage({
    client,
    userId: job.createdBy,
    channelId: job.channel,
    messageTs,
    messageText: job.prompt,
    triggerType: "scheduled",
    silentThinking: true,
    additionalSystemPrompt: buildAttribution(job),
  });
}

// ============================================================================
// Attribution
// ============================================================================

function buildAttribution(job: CronJob): string {
  const schedule = humanReadableSchedule(job.cronExpression, job.timezone);
  return `_Scheduled by <@${job.createdBy}> · ${schedule}_`;
}

export function humanReadableSchedule(cronExpression: string, timezone: string): string {
  try {
    const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
    const next = interval.next().toDate();
    const timeStr = next.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short",
    });

    // Parse cron fields for human-readable description
    const fields = cronExpression.split(/\s+/);
    if (fields.length < 5) return cronExpression;

    const [, , dayOfMonth, , dayOfWeek] = fields;

    if (dayOfWeek !== "*" && dayOfMonth === "*") {
      const days = parseDayOfWeek(dayOfWeek);
      if (days.length === 7) return `Every day at ${timeStr}`;
      if (days.length === 5 && !days.includes("Sat") && !days.includes("Sun")) {
        return `Weekdays at ${timeStr}`;
      }
      return `Every ${days.join(", ")} at ${timeStr}`;
    }

    if (dayOfMonth !== "*") {
      return `Day ${dayOfMonth} of each month at ${timeStr}`;
    }

    return `Every day at ${timeStr}`;
  } catch {
    return cronExpression;
  }
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAME_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function toDayIndex(value: string): number {
  const num = Number(value);
  if (!isNaN(num)) return num;
  return DAY_NAME_MAP[value.toLowerCase().slice(0, 3)] ?? -1;
}

function parseDayOfWeek(field: string): string[] {
  const days: string[] = [];
  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(toDayIndex);
      for (let i = start; i <= end; i++) {
        if (DAY_NAMES[i]) days.push(DAY_NAMES[i]);
      }
    } else {
      const idx = toDayIndex(part);
      if (DAY_NAMES[idx]) days.push(DAY_NAMES[idx]);
    }
  }
  return days;
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
    await client.chat.postMessage({
      channel: dmChannelId,
      text: `⚠️ Your scheduled message to <#${job.channel}> (${schedule}) failed:\n\`\`\`${errorMessage}\`\`\`\nIt will try again at the next scheduled time.`,
    });
  } catch (dmError) {
    logger.error(`Failed to DM creator ${job.createdBy} about cron error:`, dmError);
  }
}

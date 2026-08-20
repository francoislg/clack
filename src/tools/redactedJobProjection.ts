import type { CronJob } from "../cronJobs.js";
import { humanReadableSchedule } from "../cronFormatter.js";

/**
 * The redacted projection of another user's scheduled job: identity/schedule
 * metadata only. This is the ONE definition of what a non-owner may see —
 * `list_scheduled_messages` and `get_scheduled_message` both render it, and it
 * must never grow content fields (prompt, skipConditions, requiredTools,
 * attachedTopics, submitResponseMode, attentionLevel, run details).
 */
export interface RedactedJobRow {
  id: string;
  name: string | undefined;
  channel: string | undefined;
  schedule: string;
  cronExpression: string;
  enabled: boolean;
  oneShot: boolean;
  createdBy: string | null;
  systemActor: string | undefined;
  plugin: string | null;
  editableByAnyone: boolean;
  lastRunAt: string | null;
  lastRunStatus: "success" | "error" | "skipped" | null;
  redacted: true;
}

export function buildRedactedJobRow(job: CronJob): RedactedJobRow {
  return {
    id: job.id,
    name: job.name,
    channel: job.channel,
    schedule: humanReadableSchedule(job.cronExpression, job.timezone),
    cronExpression: job.cronExpression,
    enabled: job.enabled,
    oneShot: job.oneShot ?? false,
    createdBy: job.createdBy,
    systemActor: job.systemActor,
    plugin: job.plugin ?? null,
    editableByAnyone: job.editableByAnyone ?? false,
    lastRunAt: job.lastRunAt ?? null,
    lastRunStatus: job.lastRunStatus ?? null,
    redacted: true,
  };
}

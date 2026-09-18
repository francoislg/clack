import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { resolveChannelId } from "../../slack/channelResolver.js";
import { getJob, updateJob, MAX_JITTER_MINUTES } from "../../cronJobs.js";
import { humanReadableSchedule } from "../../cronFormatter.js";
import { isValidTimezone } from "../../timezone.js";
import { validateRequiredToolNames, formatRequiredToolNameError } from "../toolNameValidator.js";
import { collectKnownTopics, validateTopicNames } from "./topicValidation.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";
import { canViewFull, canEdit, isPrivateTarget, canToggleShared } from "../cronJobAccess.js";
import type { Viewer } from "../cronJobAccess.js";

export interface UpdateScheduledMessageDeps {
  collectKnownTopics: typeof collectKnownTopics;
  validateTopicNames: typeof validateTopicNames;
}

export const defaultUpdateScheduledMessageDeps: UpdateScheduledMessageDeps = {
  collectKnownTopics,
  validateTopicNames,
};

export function createUpdateScheduledMessageTool(
  ctx: QueryToolContext,
  deps: UpdateScheduledMessageDeps = defaultUpdateScheduledMessageDeps,
) {
  return tool(
    "update_scheduled_message",
    "Update an existing scheduled message. " +
      "Only provide the fields you want to change. " +
      "To change the schedule time, pass the full `schedule` object with all five cron fields — " +
      "hour/minute are in the stored (or newly-passed) timezone, NOT UTC. " +
      "When reporting back to the user, quote the `schedule` field from the tool result verbatim " +
      "— do not recompute or rephrase it. " +
      "When more than one scheduled job targets the channel in scope, confirm the target by job " +
      "NAME and creator before changing anything — never act on an ambiguous 'this automation'.",
    {
      id: z.string().describe("The scheduled message ID to update"),
      schedule: z
        .object({
          minute: z
            .string()
            .describe(
              "Cron minute field in the job's timezone (NOT UTC). Accepts any cron syntax: " +
                "'30', '0,30', '0-15', '*/15' (every 15 min), or '*' (every minute).",
            ),
          hour: z
            .string()
            .describe(
              "Cron hour field in the job's timezone (NOT UTC). Accepts any cron syntax: '9', " +
                "'9,13,17', '9-17', '*/2' (every 2 hours), or '*' (every hour).",
            ),
          dayOfMonth: z.string().describe("Cron day-of-month field (e.g. '*', '1', '1,15')."),
          month: z.string().describe("Cron month field (e.g. '*', '1', '1-6')."),
          dayOfWeek: z
            .string()
            .describe("Cron day-of-week field (e.g. '*', '1-5' for weekdays, '0,6' for weekends)."),
        })
        .optional()
        .describe(
          "Replace the full schedule. Omit to keep the existing one. All five fields are required when provided.",
        ),
      timezone: z
        .string()
        .optional()
        .describe(
          "New IANA timezone the hour/minute are expressed in (e.g. 'America/New_York', 'UTC'). Omit to keep unchanged.",
        ),
      jitterMinutes: z
        .number()
        .int()
        .min(0)
        .max(MAX_JITTER_MINUTES)
        .optional()
        .describe(
          "Forward jitter in minutes — spreads each fire by a deterministic random offset of up " +
            "to this many minutes past the scheduled time (the cron expression is never changed). " +
            `Pass 0 to clear jitter (fire precisely on schedule). Omit to leave unchanged. Max ${MAX_JITTER_MINUTES}.`,
        ),
      channel: z.string().optional().describe("New target channel"),
      prompt: z
        .string()
        .optional()
        .describe(
          "New prompt for dynamic content generation. Should only describe WHAT to do, not HOW to deliver — the scheduler handles delivery automatically.",
        ),
      requiredTools: z
        .array(z.string())
        .optional()
        .describe(
          "Replace the list of required MCP tool names (e.g. 'mcp__trivia__submit_answers'). " +
            "Pass an empty array `[]` to clear all requirements. Omit this field entirely to leave " +
            "the existing list unchanged. These two are different — `[]` is destructive.",
        ),
      plugin: z
        .string()
        .optional()
        .describe(
          "Name of a loaded Clack plugin this job is associated with. Pass an empty string " +
            "to clear. Omit to leave unchanged.",
        ),
      skipConditions: z
        .string()
        .optional()
        .describe(
          "Free-form conditions under which this run should skip posting (evaluated by Claude " +
            "at each run). Pass an empty string to clear. Omit to leave unchanged.",
        ),
      name: z
        .string()
        .max(80)
        .optional()
        .describe(
          "New short descriptive label for the schedule (up to 80 chars). Surfaced in the Home " +
            "Tab and in task cards. Omit to leave the existing name unchanged. Pass an empty " +
            "string to clear it. Pass a non-empty string to replace it.",
        ),
      attentionLevel: z
        .enum(["always", "high", "medium", "low", ""])
        .optional()
        .describe(
          "How eagerly Clack auto-follows the thread this scheduled message creates when someone " +
            'replies (always | high | medium | low). Pass an empty string "" to clear it (reverts ' +
            'to the "medium" default). Omit to leave unchanged.',
        ),
      attached_topics: z
        .array(z.string())
        .optional()
        .describe(
          "Replace the topic names pre-attached when this job fires (each topic's instruction " +
            "files load into the run's system prompt — e.g. 'response-rendering' for Slack " +
            "rendering guidance). A topic that names an integration from the AVAILABLE " +
            "INTEGRATIONS catalog also loads that integration's MCP server with the run, so its " +
            "tools are ready without attach_integration — list every integration the job uses " +
            "on each fire. Pass an empty array `[]` to clear all attached topics (lean runs). " +
            "Omit to leave the existing list unchanged.",
        ),
      enabled: z
        .boolean()
        .optional()
        .describe(
          "Pause (false) or resume (true) the schedule. THIS is the right response to 'turn off' / " +
            "'stop' / 'pause' — it is recoverable, unlike cancel_scheduled_message which removes it. " +
            "Omit to leave unchanged.",
        ),
      editable_by_anyone: z
        .boolean()
        .optional()
        .describe(
          "Mark the schedule as Shared (anyone can edit/disable/run; cancellation and this flag stay " +
            "owner/admin only) or un-share it. Only the job's owner or an admin may change this. Omit " +
            "to leave unchanged.",
        ),
    },
    async (args) => {
      const job = await getJob(args.id);
      if (!job) {
        return errorResult(`Scheduled message "${args.id}" not found.`);
      }

      const viewer: Viewer = { userId: ctx.userId, role: ctx.role };

      if (isPrivateTarget(job) && !canViewFull(job, viewer)) {
        return errorResult(`Scheduled message "${args.id}" not found.`);
      }

      if (!canEdit(job, viewer)) {
        const creatorTag = job.createdBy ? `<@${job.createdBy}>` : "the system";
        return errorResult(
          `Only the creator (${creatorTag}), an admin, or anyone on a shared schedule can update it.`,
        );
      }

      if (args.editable_by_anyone !== undefined) {
        if (isPrivateTarget(job)) {
          return errorResult(
            "This schedule targets a DM or personal surface and cannot be shared.",
          );
        }
        if (!canToggleShared(job, viewer)) {
          const creatorTag = job.createdBy ? `<@${job.createdBy}>` : "the system";
          return errorResult(
            `Only the creator (${creatorTag}) or an admin can change the shared setting.`,
          );
        }
      }

      if (job.pluginManaged) {
        return errorResult(
          `Scheduled message "${args.id}" is managed by plugin "${job.plugin ?? "unknown"}" — ` +
            "its content (schedule, prompt, channel, timezone, requiredTools, skipConditions) is reconciled " +
            "from the plugin's config block on every reload. To change it, edit the plugin's section in " +
            "data/config.json. Pausing/resuming is available from the Home Tab.",
        );
      }

      let newCronExpression: string | undefined;
      if (args.schedule) {
        const { minute, hour, dayOfMonth, month, dayOfWeek } = args.schedule;
        newCronExpression = `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;
        try {
          CronExpressionParser.parse(newCronExpression);
        } catch (error) {
          const msg = errorMessage(error);
          return errorResult(
            `Invalid schedule fields (built cron "${newCronExpression}"): ${msg}. ` +
              "All five fields accept standard cron syntax (use '*' for every, '*/N' for steps, " +
              "'A,B' for lists, 'A-B' for ranges).",
          );
        }
      }

      if (args.timezone !== undefined && !isValidTimezone(args.timezone)) {
        return errorResult(
          `Invalid timezone "${args.timezone}". Pass an IANA name like "America/New_York" or "UTC".`,
        );
      }

      // Validate requiredTools names if provided. An empty array clears the requirement and
      // doesn't need validation.
      if (args.requiredTools && args.requiredTools.length > 0) {
        const err = formatRequiredToolNameError(validateRequiredToolNames(args.requiredTools));
        if (err) return errorResult(err);
      }

      // Same shape for attached_topics: an empty array clears, so only validate non-empty lists.
      if (args.attached_topics && args.attached_topics.length > 0) {
        const topicErr = deps.validateTopicNames(
          args.attached_topics,
          deps.collectKnownTopics(ctx.mcpManager?.knownNames()),
        );
        if (topicErr) return errorResult(topicErr);
      }

      // Resolve channel if provided
      let channelId = args.channel;
      if (channelId && ctx.slackClient) {
        const resolved = await resolveChannelId(
          { client: ctx.slackClient, userId: ctx.userId },
          channelId,
        );
        if (!resolved.ok) return errorResult(resolved.error);
        channelId = resolved.channelId;
      }

      try {
        const updated = await updateJob(args.id, {
          ...(newCronExpression && { cronExpression: newCronExpression }),
          ...(args.timezone !== undefined && { timezone: args.timezone }),
          ...(args.jitterMinutes !== undefined && { jitterMinutes: args.jitterMinutes }),
          ...(channelId && { channel: channelId }),
          ...(args.prompt !== undefined && { prompt: args.prompt }),
          ...(args.requiredTools !== undefined && { requiredTools: args.requiredTools }),
          ...(args.plugin !== undefined && { plugin: args.plugin }),
          ...(args.skipConditions !== undefined && { skipConditions: args.skipConditions }),
          ...(args.name !== undefined && { name: args.name }),
          ...(args.attentionLevel !== undefined && {
            attentionLevel: args.attentionLevel === "" ? null : args.attentionLevel,
          }),
          ...(args.attached_topics !== undefined && { attachedTopics: args.attached_topics }),
          ...(args.enabled !== undefined && { enabled: args.enabled }),
          ...(args.editable_by_anyone !== undefined && {
            editableByAnyone: args.editable_by_anyone,
          }),
        });

        if (!updated) {
          return errorResult("Failed to update scheduled message.");
        }

        const schedule = humanReadableSchedule(updated.cronExpression, updated.timezone);
        return textResult({
          ok: true,
          id: updated.id,
          channel: updated.channel,
          schedule,
          type: updated.prompt ? "dynamic" : "static",
          enabled: updated.enabled,
          editableByAnyone: updated.editableByAnyone ?? false,
        });
      } catch (error) {
        logger.error("Failed to update scheduled message:", error);
        return errorResult(`Failed to update scheduled message: ${errorMessage(error)}`);
      }
    },
  );
}

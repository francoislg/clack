// Cron surface of the plugin SDK (sibling of users/memory surfaces) — bridge file.

import { CronExpressionParser } from "cron-parser";
import { isChannelId } from "../../slack/channelResolver.js";
import { logger } from "../../logger.js";
import {
  findByPluginOwner,
  createJob,
  updateJob,
  deleteJob,
  MAX_JITTER_MINUTES,
  type CronJob,
} from "../../cronJobs.js";
import { registerDelayedBootHandler, computeMissedRuns } from "../../cronCatchUp.js";
import type { ClackSdk, ClackSdkDeps, CronJobSpec } from "../sdk.js";

function validateCronJobSpec(spec: CronJobSpec): string | null {
  if (typeof spec.specKey !== "string" || spec.specKey.length === 0) {
    return "specKey must be a non-empty string";
  }
  // Channelless specs are accepted: plugins MAY omit `channel` to declare a job whose
  // delivery destination is decided at fire time by Claude via `post_to`. When supplied,
  // the shape check still applies.
  if (spec.channel !== undefined) {
    if (typeof spec.channel !== "string" || !isChannelId(spec.channel)) {
      return `channel "${spec.channel}" is not a valid Slack channel ID (expected C…/G…/D…)`;
    }
  }
  if (typeof spec.cronExpression !== "string" || spec.cronExpression.length === 0) {
    return "cronExpression must be a non-empty string";
  }
  try {
    CronExpressionParser.parse(spec.cronExpression, { tz: spec.timezone });
  } catch (err) {
    return `cronExpression "${spec.cronExpression}" is invalid: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (typeof spec.timezone !== "string" || spec.timezone.length === 0) {
    return "timezone must be a non-empty IANA tz string";
  }
  if (typeof spec.prompt !== "string" || spec.prompt.length === 0) {
    return "prompt must be a non-empty string";
  }
  if (spec.name !== undefined) {
    if (typeof spec.name !== "string") {
      return "name must be a string when provided";
    }
    const trimmed = spec.name.trim();
    if (trimmed.length === 0 || trimmed.length > 80) {
      return `name must be 1-80 characters after trim (got ${trimmed.length})`;
    }
  }
  if (
    spec.attentionLevel !== undefined &&
    !["always", "high", "medium", "low"].includes(spec.attentionLevel)
  ) {
    return `attentionLevel "${spec.attentionLevel}" is invalid (expected always | high | medium | low)`;
  }
  if (spec.jitterMinutes !== undefined) {
    if (
      !Number.isInteger(spec.jitterMinutes) ||
      spec.jitterMinutes < 0 ||
      spec.jitterMinutes > MAX_JITTER_MINUTES
    ) {
      return `jitterMinutes must be an integer in [0, ${MAX_JITTER_MINUTES}] (got ${spec.jitterMinutes})`;
    }
  }
  return null;
}

export function createCronSurface(
  pluginName: string,
  deps: Pick<
    ClackSdkDeps,
    | "findByPluginOwner"
    | "createJob"
    | "updateJob"
    | "deleteJob"
    | "registerDelayedBootHandler"
    | "computeMissedRuns"
    | "getSlackClient"
    | "executeCronJob"
  >,
): Pick<
  ClackSdk,
  "reconcileCronJobs" | "findOwnedCronJobs" | "onDelayedBoot" | "missedRuns" | "runCronJobNow"
> {
  async function resolveOwnedCronJob(specKey: string): Promise<CronJob> {
    const find = deps.findByPluginOwner ?? findByPluginOwner;
    const jobs = await find(pluginName);
    const job = jobs.find((j) => j.specKey === specKey);
    if (!job) {
      throw new Error(`No cron job with specKey "${specKey}" is owned by plugin "${pluginName}"`);
    }
    return job;
  }

  return {
    async reconcileCronJobs(ownerKey: string, specs: CronJobSpec[]): Promise<void> {
      if (typeof ownerKey !== "string" || ownerKey.length === 0) {
        throw new Error("reconcileCronJobs: ownerKey must be a non-empty string");
      }
      if (!Array.isArray(specs)) {
        throw new Error("reconcileCronJobs: specs must be an array");
      }

      // Validate every spec up front. Invalid ones are logged + skipped: they neither create
      // nor remove a job, so any existing job that matched their specKey is left untouched.
      const validSpecs: CronJobSpec[] = [];
      const invalidSpecKeys = new Set<string>();
      for (const spec of specs) {
        const err = validateCronJobSpec(spec);
        if (err) {
          const label = spec.specKey || "<no-spec-key>";
          logger.warn(
            `[plugin:${pluginName}] reconcileCronJobs: skipping invalid spec "${label}": ${err}`,
          );
          if (spec.specKey) invalidSpecKeys.add(spec.specKey);
          continue;
        }
        validSpecs.push(spec);
      }

      const find = deps.findByPluginOwner ?? findByPluginOwner;
      const create = deps.createJob ?? createJob;
      const update = deps.updateJob ?? updateJob;
      const remove = deps.deleteJob ?? deleteJob;

      const existing = await find(ownerKey);
      const existingBySpecKey = new Map(existing.map((j) => [j.specKey ?? "", j]));
      const validSpecKeys = new Set(validSpecs.map((s) => s.specKey));

      for (const spec of validSpecs) {
        const match = existingBySpecKey.get(spec.specKey);
        if (match) {
          await update(match.id, {
            cronExpression: spec.cronExpression,
            // updateJob treats `null` as "clear" — a spec that drops `channel` (or never had one)
            // clears the persisted field, switching the job to the channelless path on next fire.
            channel: spec.channel ?? null,
            prompt: spec.prompt,
            timezone: spec.timezone,
            requiredTools: spec.requiredTools ?? [],
            // updateJob treats empty string as "clear" — exactly what we want when a spec
            // drops skipConditions but the persisted job still has one.
            skipConditions: spec.skipConditions ?? "",
            // updateJob treats `null` as "clear" — dropping submitResponseMode from a spec
            // clears it from the persisted job.
            submitResponseMode: spec.submitResponseMode ?? null,
            // updateJob treats `null` as "clear" — a spec dropping silent reverts the job to
            // posting normally.
            silent: spec.silent ?? null,
            // updateJob treats an empty array as "clear" — same shape as requiredTools.
            skipDates: spec.skipDates ?? [],
            // attachedTopics: spec absent → clear the persisted field. The spec for
            // plugin-topic-instructions explicitly requires re-reconcile without the field
            // to clear it (declarative ownership), unlike `name` which is preserved on absence.
            attachedTopics: spec.attachedTopics ?? [],
            // updateJob treats `null` as "clear" — a spec dropping attentionLevel reverts the
            // job to the default-medium behavior.
            attentionLevel: spec.attentionLevel ?? null,
            // updateJob treats `null` as "clear" — a spec dropping jitterMinutes reverts the
            // job to firing on the canonical slot.
            jitterMinutes: spec.jitterMinutes ?? null,
            // updateJob: undefined leaves the persisted name untouched, while a non-empty
            // string overwrites it. The spec contract is "spec.name absent → leave alone",
            // so we deliberately omit the field rather than passing "".
            ...(spec.name !== undefined ? { name: spec.name } : {}),
          });
        } else {
          await create({
            cronExpression: spec.cronExpression,
            // Channelless specs simply omit the `channel` key — `createJob` accepts undefined.
            ...(spec.channel !== undefined ? { channel: spec.channel } : {}),
            prompt: spec.prompt,
            createdBy: null,
            systemActor: `plugin:${ownerKey}`,
            timezone: spec.timezone,
            plugin: ownerKey,
            pluginManaged: true,
            specKey: spec.specKey,
            ...(spec.name !== undefined ? { name: spec.name } : {}),
            ...(spec.requiredTools && spec.requiredTools.length > 0
              ? { requiredTools: spec.requiredTools }
              : {}),
            ...(spec.skipConditions ? { skipConditions: spec.skipConditions } : {}),
            ...(spec.submitResponseMode ? { submitResponseMode: spec.submitResponseMode } : {}),
            ...(spec.silent ? { silent: spec.silent } : {}),
            ...(spec.skipDates && spec.skipDates.length > 0 ? { skipDates: spec.skipDates } : {}),
            ...(spec.attachedTopics && spec.attachedTopics.length > 0
              ? { attachedTopics: spec.attachedTopics }
              : {}),
            ...(spec.attentionLevel ? { attentionLevel: spec.attentionLevel } : {}),
            ...(spec.jitterMinutes ? { jitterMinutes: spec.jitterMinutes } : {}),
          });
        }
      }

      // Remove owner-jobs whose specKey isn't in the valid spec list, but leave jobs
      // whose specKey appears in invalidSpecKeys — those were skipped, not removed.
      for (const job of existing) {
        const key = job.specKey ?? "";
        if (!validSpecKeys.has(key) && !invalidSpecKeys.has(key)) {
          await remove(job.id);
        }
      }
    },

    async findOwnedCronJobs(): Promise<Array<{ id: string; specKey: string }>> {
      const find = deps.findByPluginOwner ?? findByPluginOwner;
      const jobs = await find(pluginName);
      const out: Array<{ id: string; specKey: string }> = [];
      for (const j of jobs) {
        if (typeof j.specKey === "string" && j.specKey.length > 0) {
          out.push({ id: j.id, specKey: j.specKey });
        }
      }
      return out;
    },

    onDelayedBoot(handler: () => void | Promise<void>): void {
      if (typeof handler !== "function") {
        throw new Error("onDelayedBoot: handler must be a function");
      }
      const register = deps.registerDelayedBootHandler ?? registerDelayedBootHandler;
      register(pluginName, handler);
    },

    async missedRuns(specKey: string): Promise<{ lastExpectedRuns: Date[] }> {
      const job = await resolveOwnedCronJob(specKey);
      const compute = deps.computeMissedRuns ?? computeMissedRuns;
      return { lastExpectedRuns: compute(job, new Date()) };
    },

    async runCronJobNow(specKey: string): Promise<void> {
      const job = await resolveOwnedCronJob(specKey);
      if (!deps.executeCronJob) {
        throw new Error(
          `runCronJobNow("${specKey}"): no executeCronJob dependency wired in this context`,
        );
      }
      const client = deps.getSlackClient();
      if (!client) {
        throw new Error(
          `runCronJobNow("${specKey}"): no Slack client available yet — the cron scheduler has not started`,
        );
      }
      await deps.executeCronJob(job, client);
    },
  };
}

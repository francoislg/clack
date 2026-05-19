import type { Migration, StaticFileResult } from "./types.js";
import { logger } from "../logger.js";

/**
 * Normalize legacy plugin-managed cron rows that stored the plugin name in
 * `createdBy` (e.g. `"trivia"`). The new shape is `createdBy: null` plus a
 * structured `systemActor: "plugin:<plugin>"` field. User-created rows and
 * already-migrated rows are untouched.
 *
 * Idempotent: rows that already match the new shape are skipped silently.
 */

interface CronRun {
  executedAt: string;
  status: "success" | "error" | "skipped";
  responseTs?: string;
  replayOf?: string;
}

interface CronJob {
  id: string;
  cronExpression: string;
  channel: string;
  prompt: string;
  createdBy: string | null;
  systemActor?: string;
  createdAt: string;
  enabled: boolean;
  timezone: string;
  plugin?: string;
  pluginManaged?: boolean;
  specKey?: string;
  requiredTools?: string[];
  skipConditions?: string;
  oneShot?: boolean;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error" | "skipped";
  runs?: CronRun[];
}

interface CronJobsFile {
  jobs?: CronJob[];
}

const JOBS_PATH = "data/state/cron-jobs.json";

export const migration: Migration = {
  version: 20,
  name: "Rewrite legacy plugin-managed cron rows to use createdBy: null + systemActor",
  priority: "blocking",
  files: [JOBS_PATH],
  static: (files) => {
    const result: Record<string, StaticFileResult> = {};
    const raw = files[JOBS_PATH];
    if (raw === null) return result;

    let parsed: CronJobsFile;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn(
        `[migration 020] Skipping: malformed cron-jobs.json (${err instanceof Error ? err.message : String(err)}).`,
      );
      return result;
    }

    const jobs = parsed.jobs ?? [];
    let mutated = false;

    for (const job of jobs) {
      if (job.pluginManaged !== true) continue;
      if (job.createdBy === null) continue; // already migrated

      if (typeof job.plugin !== "string" || job.plugin.length === 0) {
        logger.warn(
          `[migration 020] Skipping row ${job.id} (specKey=${job.specKey ?? "?"}): pluginManaged is true but plugin field is missing or empty.`,
        );
        continue;
      }

      job.createdBy = null;
      job.systemActor = `plugin:${job.plugin}`;
      mutated = true;
      logger.info(
        `[migration 020] Rewrote row ${job.id} (specKey=${job.specKey ?? "?"}) to systemActor=${job.systemActor}.`,
      );
    }

    if (mutated) {
      parsed.jobs = jobs;
      result[JOBS_PATH] = JSON.stringify(parsed, null, 2) + "\n";
    }

    return result;
  },
};

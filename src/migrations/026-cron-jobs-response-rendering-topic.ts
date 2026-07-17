import type { Migration, StaticFileResult } from "./types.js";
import { logger } from "../logger.js";

/**
 * Stamp `attachedTopics: ["response-rendering"]` onto existing NON-plugin-managed cron
 * jobs that carry no `attachedTopics` field. The response-rendering topic split moved
 * Slack rendering guidance out of the always-loaded baseline; scheduled fires only get
 * it via `attachedTopics`, so pre-existing user schedules are stamped once to keep
 * their rich-output quality. Plugin-managed jobs are owned by plugin reconcile and are
 * left untouched.
 *
 * Idempotent: a second run finds every eligible job already stamped and writes nothing.
 * Blocking priority so jobs are stamped before the scheduler's first tick.
 */

const CRON_JOBS_PATH = "data/state/cron-jobs.json";

/** The only cron-job fields this migration reads or writes. */
interface StampableJob {
  id?: string;
  pluginManaged?: boolean;
  attachedTopics?: string[];
}

interface CronJobsFileShape {
  jobs?: StampableJob[];
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCronJobsFile(value: unknown): value is CronJobsFileShape {
  if (!isObject(value)) return false;
  const jobs = (value as CronJobsFileShape).jobs;
  return jobs === undefined || Array.isArray(jobs);
}

interface MigrateResult {
  changed: boolean;
  stampedJobs: string[];
}

export function stampAttachedTopics(root: CronJobsFileShape): MigrateResult {
  const stampedJobs: string[] = [];
  for (const job of root.jobs ?? []) {
    if (!isObject(job)) continue;
    if (job.pluginManaged === true) continue;
    if ("attachedTopics" in job) continue;
    job.attachedTopics = ["response-rendering"];
    stampedJobs.push(typeof job.id === "string" ? job.id : "(no id)");
  }

  return { changed: stampedJobs.length > 0, stampedJobs };
}

export const migration: Migration = {
  version: 26,
  name: "Stamp attachedTopics: ['response-rendering'] on existing user cron jobs",
  priority: "blocking",
  files: [CRON_JOBS_PATH],
  static: (files) => {
    const result: Record<string, StaticFileResult> = {};
    for (const [path, raw] of Object.entries(files)) {
      if (!path.endsWith("cron-jobs.json") || raw === null) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        logger.warn(
          `[migration 026] Skipping: malformed cron-jobs.json (${err instanceof Error ? err.message : String(err)}).`,
        );
        continue;
      }

      if (!isCronJobsFile(parsed)) {
        logger.warn("[migration 026] Skipping: cron-jobs.json is not in the expected shape.");
        continue;
      }

      const { changed, stampedJobs } = stampAttachedTopics(parsed);
      if (changed) {
        logger.info(
          `[migration 026] Stamped attachedTopics on ${stampedJobs.length} job(s): ${stampedJobs.join(", ")}`,
        );
        result[path] = JSON.stringify(parsed, null, 2) + "\n";
      }
    }

    return result;
  },
};

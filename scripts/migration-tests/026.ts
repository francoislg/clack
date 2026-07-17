import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 026: stamp attachedTopics: ["response-rendering"] onto existing
 * non-plugin-managed cron jobs missing the field; plugin-managed jobs stay untouched.
 */

const CRON_JOBS = "data/state/cron-jobs.json";

interface JobShape {
  id: string;
  pluginManaged?: boolean;
  attachedTopics?: string[];
}

function parseJobs(output: Record<string, string>): JobShape[] | string {
  const raw = output[CRON_JOBS];
  if (!raw) return `${CRON_JOBS} missing from output`;
  const parsed: { jobs?: JobShape[] } = JSON.parse(raw);
  return parsed.jobs ?? [];
}

function job(id: string, extra: Partial<JobShape> = {}): JobShape & { prompt: string } {
  return { id, prompt: "do something", ...extra };
}

export const test: MigrationTest = {
  version: 26,
  fileCases: [
    {
      name: "stamps user jobs missing attachedTopics, leaves plugin-managed jobs alone",
      inputFiles: {
        [CRON_JOBS]: JSON.stringify({
          jobs: [
            job("user-job"),
            job("plugin-job", { pluginManaged: true }),
            job("already-set", { attachedTopics: ["trivia"] }),
          ],
        }),
      },
      validateFiles: (output) => {
        const jobs = parseJobs(output);
        if (typeof jobs === "string") return jobs;
        const byId = new Map(jobs.map((j) => [j.id, j]));
        if (JSON.stringify(byId.get("user-job")?.attachedTopics) !== '["response-rendering"]')
          return "user-job should have been stamped with ['response-rendering']";
        if ("attachedTopics" in (byId.get("plugin-job") ?? {}))
          return "plugin-managed job must not be stamped";
        if (JSON.stringify(byId.get("already-set")?.attachedTopics) !== '["trivia"]')
          return "job with an existing attachedTopics must be left unchanged";
        return null;
      },
    },
    {
      name: "already migrated file is a no-op (all jobs stamped or plugin-managed)",
      inputFiles: {
        [CRON_JOBS]: JSON.stringify({
          jobs: [
            job("stamped", { attachedTopics: ["response-rendering"] }),
            job("plugin-job", { pluginManaged: true }),
          ],
        }),
      },
      validateFiles: (output) => {
        const jobs = parseJobs(output);
        if (typeof jobs === "string") return jobs;
        const byId = new Map(jobs.map((j) => [j.id, j]));
        if (JSON.stringify(byId.get("stamped")?.attachedTopics) !== '["response-rendering"]')
          return "stamped job must keep its attachedTopics";
        if ("attachedTopics" in (byId.get("plugin-job") ?? {}))
          return "plugin-managed job must stay unstamped";
        return null;
      },
    },
    {
      name: "empty jobs array is a no-op",
      inputFiles: {
        [CRON_JOBS]: JSON.stringify({ jobs: [] }),
      },
      validateFiles: (output) => {
        const jobs = parseJobs(output);
        if (typeof jobs === "string") return jobs;
        if (jobs.length !== 0) return "no jobs should have appeared";
        return null;
      },
    },
  ],
};

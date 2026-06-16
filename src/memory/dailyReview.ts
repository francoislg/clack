import { getJobs, createJob, updateJob, type CronJob } from "../cronJobs.js";
import { logger } from "../logger.js";

/** Identifies the core-owned memory review cron (matched on reconcile so it's never duplicated). */
export const MEMORY_SYSTEM_ACTOR = "memory";
const SPEC_KEY = "daily-review";

/** Midnight daily. */
const REVIEW_CRON = "0 0 * * *";

/**
 * Timezone the review fires in. A module constant for now — Clack is single-operator, and a
 * config override can be layered later without changing the contract.
 */
export const DEFAULT_REVIEW_TIMEZONE = "America/Toronto";

const REVIEW_PROMPT = `MEMORY REVIEW — keep Clack's memory relevant. You post nothing; end with skip_response.

Walk every memory entry and decide whether it still matters:
1. Page through all entries with the recall tool (use limit/offset; no query returns everything).
2. For each entry that has references, re-run each reference's howToRead recipe to fetch its CURRENT status before judging. If a fetch errors, log nothing and KEEP the entry — never forget on a failed fetch.
3. Judge relevance:
   - If the entry is clearly no longer relevant (referenced work resolved/closed AND its staleAfter has passed, or a note whose staleAfter.date is past and reason no longer holds), call forget(id). A plugin with live work may veto — that is expected; move on.
   - If it still matters, leave it, or call remember to refresh its what / push staleAfter.date out to reflect the new status.
   - Entries with no references are judged on staleAfter (date + reason) alone — no fetch.
4. Do not invent entries and do not change plugin-owned state. End the fire (skip_response).`;

function reviewJobExists(jobs: CronJob[]): CronJob | undefined {
  return jobs.find((j) => j.systemActor === MEMORY_SYSTEM_ACTOR && j.specKey === SPEC_KEY);
}

/**
 * Register (or refresh) the daily memory-review cron. Idempotent: matched by `systemActor` +
 * `specKey` so a restart updates the existing job in place instead of creating a duplicate.
 */
export async function reconcileMemoryReviewCron(timezone = DEFAULT_REVIEW_TIMEZONE): Promise<void> {
  const jobs = await getJobs();
  const existing = reviewJobExists(jobs);

  if (!existing) {
    await createJob({
      cronExpression: REVIEW_CRON,
      prompt: REVIEW_PROMPT,
      name: "Memory review",
      createdBy: null,
      systemActor: MEMORY_SYSTEM_ACTOR,
      timezone,
      submitResponseMode: "skipped",
      silent: true,
      specKey: SPEC_KEY,
    });
    logger.info("Registered daily memory-review cron");
    return;
  }

  await updateJob(existing.id, {
    cronExpression: REVIEW_CRON,
    prompt: REVIEW_PROMPT,
    name: "Memory review",
    timezone,
    submitResponseMode: "skipped",
    silent: true,
  });
}

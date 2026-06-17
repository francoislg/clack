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

Walk every memory entry and decide what to do with it:
1. Page through all entries with the recall tool (use limit/offset; no query returns everything).
2. For each entry that has references, re-run each reference's howToRead recipe to fetch its CURRENT status before judging. If a fetch errors, log nothing and KEEP the entry — never forget or archive on a failed fetch.
3. Make a three-way decision:
   - STILL RELEVANT → leave it, or call remember to refresh its what / push staleAfter.date out to reflect the new status.
   - DONE BUT WORTH REMEMBERING (referenced work resolved/closed AND its staleAfter has passed — a fixed issue, a merged PR) → call archive(id, ...) with a lean note: summary (≤1 line, what it was about), outcome (how it resolved — e.g. "Fixed in PR #123, merged 2026-06-10" or "Abandoned: dupe of sentry:99"), and an optional link (bare URL to the resolving artifact; omit if none). This removes the active entry and keeps the outcome retrievable by id for future recurrences. A plugin with live work may veto — that is expected; move on.
   - NOISE, NEVER WORTH REMEMBERING (a note whose staleAfter.date is past and reason no longer holds, with no outcome worth keeping) → call forget(id), a true delete.
   - Entries with no references are judged on staleAfter (date + reason) alone — no fetch.
4. Do not invent entries and do not change plugin-owned state.
5. FINAL STEP: call prune_archive once to drop archive records past the retention horizon. Then end the fire (skip_response).`;

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

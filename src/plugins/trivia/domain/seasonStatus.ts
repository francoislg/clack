import { CronExpressionParser } from "cron-parser";
import { triviaLogger as logger } from "../core/pluginLogger.js";

/**
 * Plugin-local minimal shape of a persisted cron job. We deliberately do NOT
 * import the bot-core CronJob type — per the plugin hard rules, plugins must
 * not reach into bot internals. This structural type captures only the fields
 * this module touches.
 */
export interface TriviaCronJobView {
  plugin?: string;
  enabled?: boolean;
  specKey?: string;
  prompt: string;
  requiredTools?: string[];
  cronExpression: string;
  timezone: string;
}

/**
 * Locate the trivia reveal cron job for a given game.
 *
 * Plugin-managed reveal specs carry `specKey: "<name>:reveal"` — that's the canonical
 * match. Legacy detection (jobs predating `buildGameSpecs`) falls back to inspecting
 * the prompt / requiredTools for the legacy reveal instruction name.
 */
export function findTriviaRevealJob(
  jobs: TriviaCronJobView[],
  gameName: string,
  legacyMarker: string,
): TriviaCronJobView | null {
  const triviaJobs = jobs.filter((j) => j.plugin === "trivia" && j.enabled !== false);
  const direct = triviaJobs.find((j) => j.specKey === `${gameName}:reveal`);
  if (direct) return direct;
  const legacy = triviaJobs.find(
    (j) =>
      j.prompt.includes(legacyMarker) || j.requiredTools?.some((t) => t.includes(legacyMarker)),
  );
  return legacy ?? null;
}

/**
 * Compute the next-fire instant of `job`'s cron expression strictly after `after`.
 * Returns null when the expression is invalid (a warning is logged with the cron text).
 */
export function nextFireAfter(job: TriviaCronJobView, after: Date): Date | null {
  try {
    const interval = CronExpressionParser.parse(job.cronExpression, {
      currentDate: after,
      tz: job.timezone,
    });
    return interval.next().toDate();
  } catch (error) {
    logger.error(
      `nextFireAfter: invalid cron "${job.cronExpression}" tz="${job.timezone}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

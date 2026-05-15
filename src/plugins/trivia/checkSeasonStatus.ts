import { CronExpressionParser } from "cron-parser";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { loadJobs, type CronJob } from "../../cronJobs.js";
import { logger } from "../../logger.js";
import { findCurrentSeason, findNextSeason } from "./data.js";
import type { TriviaDataLayer } from "./types.js";

const REVEAL_INSTRUCTION_NAME = "process_responses_instructions";

function findTriviaRevealJob(jobs: CronJob[]): CronJob | null {
  const triviaJobs = jobs.filter((j) => j.plugin === "trivia" && j.enabled !== false);
  const reveal = triviaJobs.find(
    (j) =>
      j.prompt.includes(REVEAL_INSTRUCTION_NAME) ||
      j.requiredTools?.some((t) => t.includes(REVEAL_INSTRUCTION_NAME)),
  );
  return reveal ?? null;
}

function nextFireAfter(job: CronJob, after: Date): Date | null {
  try {
    const interval = CronExpressionParser.parse(job.cronExpression, {
      currentDate: after,
      tz: job.timezone,
    });
    return interval.next().toDate();
  } catch (error) {
    logger.error(
      `check_season_status: invalid cron "${job.cronExpression}" tz="${job.timezone}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

type JobsLoader = () => Promise<CronJob[]>;

export function createCheckSeasonStatusTool(
  data: TriviaDataLayer,
  jobsLoader: JobsLoader = loadJobs,
) {
  return tool(
    "check_season_status",
    "Inspect the current trivia season and the next-queued season on the timeline. Returns currentSlug, currentExpectedEndAt, isLastFireOfSeason, nextSeasonSlug, nextSeasonStartsAt, and isInGap. Call this near the top of the answer-reveal flow when seasons are enabled.",
    {},
    async () => {
      const state = await data.loadSeasonsState();
      if (state === null) {
        return errorResult(
          "Seasons are not initialized (seasons.json missing). The plugin's first-enable initialization should have created it when seasons.enabled was first observed true.",
        );
      }

      const now = new Date();
      const nowMs = now.getTime();
      const current = findCurrentSeason(state, nowMs);
      // "Next" is computed relative to the current season's expected end when one exists, otherwise relative to now.
      // We subtract 1 from expectedEndAt so a back-to-back season (startedAt === expectedEndAt) qualifies as next.
      const nextBaseline = (current?.expectedEndAt ?? nowMs) - 1;
      const next = findNextSeason(state, nextBaseline);

      // Gap: no current season at this moment.
      if (current === null) {
        return textResult({
          currentSlug: null,
          currentExpectedEndAt: null,
          isLastFireOfSeason: false,
          nextSeasonSlug: next?.slug ?? null,
          nextSeasonStartsAt: next?.startedAt ?? null,
          isInGap: true,
        });
      }

      const jobs = await jobsLoader();
      const reveal = findTriviaRevealJob(jobs);

      if (reveal === null) {
        logger.warn(
          "check_season_status: no trivia reveal cron found — defaulting isLastFireOfSeason to false",
        );
        return textResult({
          currentSlug: current.slug,
          currentExpectedEndAt: current.expectedEndAt,
          isLastFireOfSeason: false,
          nextSeasonSlug: next?.slug ?? null,
          nextSeasonStartsAt: next?.startedAt ?? null,
          isInGap: false,
          warning: "No trivia reveal schedule found; defaulting to mid-season behavior.",
        });
      }

      const nextFire = nextFireAfter(reveal, now);
      // No next fire OR next fire past the current season's expected end → today is the last fire.
      const isLastFireOfSeason = nextFire === null || nextFire.getTime() > current.expectedEndAt;

      return textResult({
        currentSlug: current.slug,
        currentExpectedEndAt: current.expectedEndAt,
        isLastFireOfSeason,
        nextSeasonSlug: next?.slug ?? null,
        nextSeasonStartsAt: next?.startedAt ?? null,
        nextFireAt: nextFire?.getTime() ?? null,
        isInGap: false,
      });
    },
  );
}

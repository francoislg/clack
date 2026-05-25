import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
// TODO(plugin-isolation): loadJobs reaches into bot-core cron-job state.
// Move to an SDK accessor (e.g. sdk.listOwnerCronJobs) in a follow-up.
import { loadJobs } from "../../../../cronJobs.js";
import { triviaLogger as logger } from "../../core/pluginLogger.js";
import { findCurrentSeason, findNextSeason } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import {
  findTriviaRevealJob,
  nextFireAfter,
  type TriviaCronJobView,
} from "../../domain/seasonStatus.js";
import type { TriviaDataLayer } from "../../core/types.js";

const REVEAL_INSTRUCTION_NAME = "process_responses_instructions";

type JobsLoader = () => Promise<TriviaCronJobView[]>;

export function createCheckSeasonStatusTool(
  data: TriviaDataLayer,
  jobsLoader: JobsLoader = loadJobs,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "check_season_status",
    "Inspect the current trivia season and the next-queued season on the named game's timeline. Returns currentSlug, currentExpectedEndAt, isLastFireOfSeason, nextSeasonSlug, nextSeasonStartsAt, and isInGap. Call this near the top of the answer-reveal flow when seasons are enabled.",
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). The status is computed from this game's seasons.json only.",
        ),
    },
    async (args) => {
      try {
        requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const state = await scoped.loadSeasonsState();
      if (state === null) {
        return errorResult(
          `Seasons are not initialized for game "${args.game}" (seasons.json missing). The plugin's lazy bootstrap should have created it when seasons.enabled was first observed true.`,
        );
      }

      const now = new Date();
      const nowMs = now.getTime();
      const current = findCurrentSeason(state, nowMs);
      const nextBaseline = (current?.expectedEndAt ?? nowMs) - 1;
      const next = findNextSeason(state, nextBaseline);

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
      const reveal = findTriviaRevealJob(jobs, args.game, REVEAL_INSTRUCTION_NAME);

      if (reveal === null) {
        logger.warn(
          `check_season_status: no trivia reveal cron found for game "${args.game}" — defaulting isLastFireOfSeason to false`,
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

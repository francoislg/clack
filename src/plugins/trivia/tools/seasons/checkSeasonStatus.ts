import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { triviaLogger as logger } from "../../core/pluginLogger.js";
import { findCurrentSeason, findNextSeason } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import { nextCronFireAfter, isLastFireBeforeSeasonEnd } from "../../domain/seasonStatus.js";
import type { TriviaDataLayer } from "../../core/types.js";

export function createCheckSeasonStatusTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "check_season_status",
    "Inspect the current trivia season and the next-queued season on the named game's timeline. Returns currentSlug, currentExpectedEndAt, isLastFireOfSeason, nextSeasonSlug, nextSeasonStartsAt, and isInGap. `isLastFireOfSeason` is derived from the game's own `revealCron` config — it does NOT read the bot-core cron-job registry. Call this near the top of the answer-reveal flow when seasons are enabled.",
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

      const game = getGamesFn().find((g) => g.name === args.game);
      const revealCron = game?.revealCron;

      if (!revealCron) {
        logger.warn(
          `check_season_status: game "${args.game}" has no revealCron — defaulting isLastFireOfSeason to false`,
        );
        return textResult({
          currentSlug: current.slug,
          currentExpectedEndAt: current.expectedEndAt,
          isLastFireOfSeason: false,
          nextSeasonSlug: next?.slug ?? null,
          nextSeasonStartsAt: next?.startedAt ?? null,
          isInGap: false,
          warning: "No trivia reveal schedule configured; defaulting to mid-season behavior.",
        });
      }

      const nextFire = nextCronFireAfter(revealCron, game?.timezone, now);
      const isLastFireOfSeason = isLastFireBeforeSeasonEnd(nextFire, current.expectedEndAt);

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

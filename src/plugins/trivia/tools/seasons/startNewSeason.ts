import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { applySeasonRollover } from "../reveal/rollover.js";
import type { TriviaDataLayer } from "../../core/types.js";

const DESCRIPTION = `Perform the season-end rollover for a game: stamp \`endedAt\` on the current season and, when no future season is already queued, create the continuation season for next month (inheriting answersFormat/questionType/contexts/format; season-level categories reset to the cascade). It does NOT score answers, edit cards, or post messages.

Call this from the reveal flow ONLY on the season's last fire (when \`compute_answers\` reported \`seasonStatus.isLastFireOfSeason === true\`). Do NOT call it on a mid-season reveal — it closes whatever season is currently active. The whole-reveal replay path is safe: re-running the reveal re-resolves the season via \`compute_answers\`, which won't re-flag an already-closed season as the last fire. At the season level it never re-stamps a season that already has \`endedAt\` and never duplicates an already-queued continuation.`;

export function createStartNewSeasonTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "start_new_season",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe("Game name (must be present in config.trivia.games[] and not disabled)."),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const state = await scoped.loadSeasonsState();
      if (state === null) {
        return errorResult(
          `Seasons are not initialized for game "${args.game}" (seasons.json missing).`,
        );
      }

      const now = Date.now();
      const current = findCurrentSeason(state, now);
      if (current === null) {
        return textResult({
          game: args.game,
          seasonClosed: false,
          message: "No current season to roll over (in a gap or seasons not started).",
        });
      }

      const outcome = applySeasonRollover(state, current.slug, now);
      if (outcome.seasonClosed || outcome.newSeasonStarted !== undefined) {
        await scoped.saveSeasonsState(state);
      }

      return textResult({
        game: args.game,
        closedSlug: current.slug,
        seasonClosed: outcome.seasonClosed,
        ...(outcome.newSeasonStarted ? { newSeasonStarted: outcome.newSeasonStarted } : {}),
      });
    },
  );
}

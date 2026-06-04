import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { nextCronFireAfter, isLastFireBeforeSeasonEnd } from "../../domain/seasonStatus.js";
import { applySeasonRollover } from "../reveal/rollover.js";
import type { TriviaDataLayer } from "../../core/types.js";

const DESCRIPTION = `Perform the season-end rollover for a game: stamp \`endedAt\` on the current season and, when no future season is already queued, create the continuation season for next month (inheriting answersFormat/questionType/contexts/format; season-level categories reset to the cascade). It does NOT score answers, edit cards, or post messages.

Call this from the reveal flow ONLY on the season's last fire (when \`compute_answers\` reported \`seasonStatus.isLastFireOfSeason === true\`). Do NOT call it on a mid-season reveal — it closes whatever season is currently active. The whole-reveal replay path is safe: re-running the reveal re-resolves the season via \`compute_answers\`, which won't re-flag an already-closed season as the last fire. At the season level it never re-stamps a season that already has \`endedAt\` and never duplicates an already-queued continuation.

CONFIRMATION GUARD: this tool re-derives \`isLastFireOfSeason\` from the game's own \`revealCron\` before closing anything. When it is NOT the last fire, the tool performs NO change and returns \`{ requiresConfirmation: true }\` with a warning that ending the season early is irreversible — re-read it and only proceed if an early/manual rollover is truly intended. To go through anyway (admin-initiated mid-season rollover), call again with \`force: true\`. The normal reveal-flow call needs NO \`force\`: on a genuine last fire the guard passes automatically.`;

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
      force: z
        .boolean()
        .optional()
        .describe(
          "Bypass the last-fire confirmation guard and roll over even though it is NOT the season's last scheduled reveal. Reserve for a deliberate, admin-initiated mid-season rollover — ending a season early is irreversible. The reveal flow must NOT set this.",
        ),
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

      // Structural last-fire guard: re-derive `isLastFireOfSeason` the same way
      // `compute_answers`/`check_season_status` do, so a stray call that ignored the
      // prompt's "only on the last fire" rule can't silently end a season early.
      // Absent revealCron → can't confirm → treat as NOT the last fire (force required).
      const game = getGamesFn().find((g) => g.name === args.game);
      const revealCron = game?.revealCron;
      const nextFire = revealCron
        ? nextCronFireAfter(revealCron, game?.timezone, new Date(now))
        : null;
      const isLastFire =
        revealCron !== undefined && isLastFireBeforeSeasonEnd(nextFire, current.expectedEndAt);

      if (!isLastFire && args.force !== true) {
        return textResult({
          game: args.game,
          seasonClosed: false,
          requiresConfirmation: true,
          currentSlug: current.slug,
          currentExpectedEndAt: current.expectedEndAt,
          nextFireAt: nextFire?.getTime() ?? null,
          warning:
            `This is NOT the season's last scheduled reveal. The next reveal fires ` +
            `${nextFire ? nextFire.toISOString() : "(unknown — game has no revealCron)"}, on or before ` +
            `season "${current.slug}"'s expected end (${new Date(current.expectedEndAt).toISOString()}). ` +
            `Starting a new season now permanently ends "${current.slug}" early and CANNOT be undone. ` +
            `Double-check that an early/manual rollover is truly intended; if so, call start_new_season again with force: true.`,
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

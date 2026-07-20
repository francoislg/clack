import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { findCurrentSeason, findNextSeason } from "../../core/seasonTimeline.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireGame, GameDisabledError } from "../../core/gamesRegistry.js";
import { nextCronFireAfter, isLastFireBeforeSeasonEnd } from "../../domain/seasonStatus.js";
import { windDownGame } from "../../domain/windDown.js";
import { hasUnrevealedPostedQuestions } from "../../domain/boardState.js";
import { applySeasonRollover } from "../reveal/rollover.js";
import type { TriviaDataLayer } from "../../core/types.js";
import type { TriviaGame } from "../../core/configTypes.js";

const DESCRIPTION = `End the current round for a game. Closing is the guaranteed action; what follows is server-resolved policy, branching on whether a season is active:

ACTIVE SEASON: stamp \`endedAt\` on the current season, then — a queued future season is promoted, OR (when the game's \`disableAfterRound\` is true) NO successor is created and the game winds itself down (\`enabled: false\` persisted, result carries \`gameDisabled: true\`), OR a continuation season for next month is created (inheriting answersFormat/questionType/contexts/format; season-level categories reset to the cascade). It does NOT score answers, edit cards, or post messages.

NO ACTIVE SEASON (seasons disabled workspace-wide, or the timeline is in a gap): when the game carries \`disableAfterRound: true\` and the board is cleared (zero posted-but-unrevealed questions), the game winds down the same way. Without the flag, the tool reports there is no current season and changes nothing.

Call this from the reveal flow ONLY when \`compute_answers\` reported \`seasonStatus.isLastFireOfSeason === true\` OR \`windDown: { eligible: true }\`. The whole-reveal replay path is safe: re-running the reveal re-resolves via \`compute_answers\`, the season-level close is idempotent (never re-stamps \`endedAt\`, never duplicates a queued continuation), and replaying an already-wound-down finale is a no-op success (\`alreadyWoundDown: true\`). When the result carries \`gameDisabled: true\`, render the finale as a series wrap (the game is over for good — no next-season preview); corrections afterward require re-enable → fix → re-disable by hand (the result message carries the recipe).

CONFIRMATION GUARD (season branch): the tool re-derives \`isLastFireOfSeason\` from the game's own \`revealCron\` before closing anything. When it is NOT the last fire, the tool performs NO change and returns \`{ requiresConfirmation: true }\` — ending a season early is irreversible, so only proceed with \`force: true\` when an early/manual close is truly intended. On a \`disableAfterRound\` game, \`force\` ALSO winds the game down (ending it now means ending it — the result surfaces \`gameDisabled: true\`). On the seasonless branch, \`force\` bypasses ONLY the board-cleared check.`;

export function createEndSeasonTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
  getTriviaConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
) {
  return tool(
    "end_season",
    DESCRIPTION,
    {
      game: z.string().describe("Game name (must be present in config.trivia.games[])."),
      force: z
        .boolean()
        .optional()
        .describe(
          "Season branch: bypass the last-fire confirmation guard and close early — irreversible; reserve for a deliberate, admin-initiated early close, and note that on a `disableAfterRound` game this ALSO disables the game. Seasonless branch: bypass ONLY the board-cleared check. The reveal flow must NOT set this.",
        ),
    },
    async (args) => {
      let game: TriviaGame;
      try {
        game = requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const now = Date.now();
      const state = await scoped.loadSeasonsState();
      const current = state === null ? null : findCurrentSeason(state, now);

      // Disabled game: a replayed wound-down finale is a no-op success; any other
      // disabled state refuses (a disabled game's timeline is not mutable).
      if (game.enabled === false) {
        const timelineClosed = current === null || current.endedAt !== undefined;
        if (game.disableAfterRound === true && timelineClosed) {
          return textResult({
            game: args.game,
            seasonClosed: true,
            gameDisabled: true,
            alreadyWoundDown: true,
            message: `Game "${args.game}" is already wound down — nothing to do.`,
          });
        }
        return errorResult(new GameDisabledError(args.game).message);
      }

      if (state === null || current === null) {
        if (game.disableAfterRound !== true) {
          if (state === null) {
            return errorResult(
              `Seasons are not initialized for game "${args.game}" (seasons.json missing).`,
            );
          }
          return textResult({
            game: args.game,
            seasonClosed: false,
            message: "No current season to roll over (in a gap or seasons not started).",
          });
        }
        // A queued future season means the game is between rounds, not over —
        // never wind down past it (not even with force; force bypasses only the
        // board-cleared check).
        const queued = state === null ? null : findNextSeason(state, now);
        if (queued !== null) {
          return textResult({
            game: args.game,
            seasonClosed: false,
            message:
              `No current season to close, and season "${queued.slug}" is queued to start — ` +
              `the game is between rounds, not over. Not winding down.`,
          });
        }
        // Seasonless wind-down: the "round" is the board. Only a cleared board
        // (every posted question revealed) counts as round-done; force is the
        // deliberate manual override for that single check.
        if (args.force !== true) {
          const questions = await scoped.loadQuestions();
          if (hasUnrevealedPostedQuestions(questions)) {
            return errorResult(
              `Cannot wind down "${args.game}": posted question(s) are not yet revealed. ` +
                `Let the reveal run first, or pass force: true to wind down anyway.`,
            );
          }
        }
        const windDown = await windDownGame(args.game);
        return textResult({ game: args.game, seasonClosed: false, ...windDown });
      }

      // Structural last-fire guard: re-derive `isLastFireOfSeason` the same way
      // `compute_answers`/`check_season_status` do, so a stray call that ignored the
      // prompt's "only on the last fire" rule can't silently end a season early.
      // Absent revealCron → can't confirm → treat as NOT the last fire (force required).
      const revealCron = game.revealCron;
      const nextFire = revealCron
        ? nextCronFireAfter(revealCron, game.timezone, new Date(now))
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
            `Ending "${current.slug}" now permanently closes it early and CANNOT be undone. ` +
            `Double-check that an early/manual close is truly intended; if so, call end_season again with force: true.`,
        });
      }

      const windingDown = game.disableAfterRound === true;
      const outcome = applySeasonRollover(
        state,
        current.slug,
        now,
        { game, workspace: getTriviaConfigFn() },
        { skipContinuation: windingDown },
      );
      if (
        outcome.seasonClosed ||
        outcome.newSeasonStarted !== undefined ||
        outcome.teamsStamped === true
      ) {
        await scoped.saveSeasonsState(outcome.state);
      }

      // The disable is the LAST mutation: the seasons-state save above lands
      // first, so a crash in between leaves a closed season on an enabled game
      // and the re-run converges through this same branch.
      if (windingDown) {
        const windDown = await windDownGame(args.game);
        return textResult({
          game: args.game,
          closedSlug: current.slug,
          seasonClosed: outcome.seasonClosed,
          ...windDown,
        });
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

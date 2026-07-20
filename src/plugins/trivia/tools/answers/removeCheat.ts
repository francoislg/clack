import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { reprocessThenRepaintHint } from "../../core/refreshHint.js";
import type { TriviaDataLayer } from "../../core/types.js";

const DESCRIPTION = `Remove a cheat report against a player on a trivia question — the inverse of save_cheating. Admin-only.

Drops every cheat entry matching (cheaterUserId, questionId) from the game's cheats.json and decrements the player's cumulative cheat counter by the number removed (floored at 0). Use when a cheat was recorded wrongly or against the wrong person. A no-match call changes nothing (safe to retry).

Cheats filter scoring at reveal time, so if the affected question was already revealed, refresh the posted card afterward: \`compute_answers\` (reprocess this question) → \`refresh_question_cards\`.`;

export function createRemoveCheatTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "remove_cheat",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). The cheat report is removed from this game's cheats.json.",
        ),
      cheaterUserId: z
        .string()
        .describe("Slack user ID whose cheat report(s) on this question should be removed"),
      questionId: z.string().describe("Trivia question ID the cheat report(s) concern"),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const { removedCount, totalAttempts } = await scoped.removeCheat(
        args.cheaterUserId,
        args.questionId,
      );

      if (removedCount === 0) {
        return textResult({
          removed: 0,
          message: `No cheat report from <@${args.cheaterUserId}> on question "${args.questionId}" was found.`,
          totalAttempts,
        });
      }

      const questions = await scoped.loadQuestions();
      const question = questions.find((q) => q.id === args.questionId);
      const revealAlreadyPosted = question?.processedAt !== undefined;

      return textResult({
        removed: removedCount,
        cheaterUserId: args.cheaterUserId,
        questionId: args.questionId,
        totalAttempts,
        ...(revealAlreadyPosted ? { refreshHint: reprocessThenRepaintHint(args.questionId) } : {}),
      });
    },
  );
}

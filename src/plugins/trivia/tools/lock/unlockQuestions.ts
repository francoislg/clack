import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer } from "../../core/types.js";
import { transitionLock } from "./applyLock.js";
import type { LockSlackDeps } from "./lockQuestions.js";

const DESCRIPTION = `Admin escape hatch that reverses lock_questions: for every locked, not-yet-revealed question in the game, it clears \`answerLocked\` and repaints the card with its answer buttons (and live roster) restored. Use when a lock fired too early or an event was postponed and voting should reopen.

It posts NO new Slack message, only edits existing cards. It is idempotent (unlocked and already-revealed questions are skipped) and per-card isolated. Already-revealed questions are never reopened.`;

const SLACK_UNAVAILABLE_ERROR =
  "Slack client is not available. The bot's Socket Mode session must be connected for unlock_questions to edit cards.";

export function createUnlockQuestionsTool(
  data: TriviaDataLayer,
  sdk: LockSlackDeps,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "unlock_questions",
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

      const client = sdk.getSlackClient();
      if (client === null) return errorResult(SLACK_UNAVAILABLE_ERROR);

      const scoped = data.forGame(args.game);
      const questions = await scoped.loadQuestions();
      const targets = questions.filter(
        (q) => q.answerLocked === true && q.processedAt === undefined,
      );

      const { changed, errors } = await transitionLock({
        scoped,
        data,
        client,
        targets,
        answerLocked: false,
      });

      return textResult({
        game: args.game,
        unlocked: changed,
        ...(errors.length > 0 ? { errors } : {}),
      });
    },
  );
}

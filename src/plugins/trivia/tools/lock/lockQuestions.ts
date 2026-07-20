import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import type { RosterEditClient } from "../../freeform/roster.js";
import type { TriviaDataLayer } from "../../core/types.js";
import { transitionLock } from "./applyLock.js";

/**
 * The lock tools only need a chat.update-capable Slack client. The real `ClackSdk`
 * satisfies this structurally (its `getSlackClient()` returns the full WebClient),
 * so production passes `sdk` directly and tests can supply a narrow fake.
 */
export interface LockSlackDeps {
  getSlackClient(): RosterEditClient | null;
}

const DESCRIPTION = `Freeze voting on a trivia game's posted-but-unrevealed questions. For every question in the game that is posted, not yet revealed, and not already locked, this stamps \`answerLocked: true\` and repaints its Slack card WITHOUT the answer buttons — replacing them with a "locked in — waiting on results" notice. Fired by a game's optional \`lockCron\`; typically scheduled between question time and reveal (e.g. at an event's kickoff).

It posts NO new Slack message, only edits existing cards. It is idempotent (already-locked and already-revealed questions are skipped) and per-card isolated (one card's edit failure is logged and does not abort the rest). The reveal flow is unaffected — reveal strips the buttons regardless of lock state.`;

const SLACK_UNAVAILABLE_ERROR =
  "Slack client is not available. The bot's Socket Mode session must be connected for lock_questions to edit cards.";

export function createLockQuestionsTool(
  data: TriviaDataLayer,
  sdk: LockSlackDeps,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "lock_questions",
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
        (q) => q.postedAt !== undefined && q.processedAt === undefined && q.answerLocked !== true,
      );

      const { changed, errors } = await transitionLock({
        scoped,
        data,
        client,
        targets,
        answerLocked: true,
      });

      return textResult({
        game: args.game,
        locked: changed,
        ...(errors.length > 0 ? { errors } : {}),
      });
    },
  );
}

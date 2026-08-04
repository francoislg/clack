import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { TRIVIA_USER_PREFS_SCHEMA } from "../../core/userPrefs.js";
import type { TriviaDataLayer } from "../../core/types.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import {
  pendingQuestionIds,
  answeredUserIds,
  unplayedCandidates,
} from "../../domain/reminderAudience.js";

/**
 * SDK surface needed for DM delivery and preference access.
 */
export interface RemindSlackDeps {
  dmUser(userId: string, text: string): Promise<{ ok: boolean; error?: string }>;
  preferences: {
    get(
      userId: string,
      schema: typeof TRIVIA_USER_PREFS_SCHEMA,
    ): Promise<ReturnType<typeof TRIVIA_USER_PREFS_SCHEMA.parse> | null>;
  };
  logger: { warn(...args: unknown[]): void };
}

const DESCRIPTION =
  "Remind players who haven't answered the current round that answers are closing soon. Sends a DM to opted-in players who are candidates but haven't yet submitted an answer to any of the pending questions.";

export function createRemindUnplayedTool(
  data: TriviaDataLayer,
  sdk: RemindSlackDeps,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "remind_unplayed",
    DESCRIPTION,
    {
      game: z.string().describe("Game name (must be present in config.trivia.games[])"),
      message: z.string().min(1).describe("DM message to send to unplayed candidates"),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const questions = await scoped.loadQuestions();
      const pendingIds = pendingQuestionIds(questions);

      if (pendingIds.length === 0) {
        return textResult({
          game: args.game,
          reminded: 0,
          message: "No current round pending reveal.",
        });
      }

      const answers = await scoped.loadAnswers();
      const answered = answeredUserIds(answers, pendingIds);

      const users = await data.loadUsers();
      const candidates = [...users.keys()];
      const unplayed = unplayedCandidates(candidates, answered);

      let reminded = 0;
      let skipped = 0;

      for (const userId of unplayed) {
        const prefs = await sdk.preferences.get(userId, TRIVIA_USER_PREFS_SCHEMA);
        if (prefs?.revealReminders !== true) {
          skipped++;
          continue;
        }

        try {
          const result = await sdk.dmUser(userId, args.message);
          if (result.ok) {
            reminded++;
          } else {
            sdk.logger.warn(`remind_unplayed: DM to ${userId} failed: ${result.error}`);
          }
        } catch (err) {
          // Continue past per-user DM failures — dmUser is contracted fail-soft, so a throw
          // here is unexpected; surface it rather than swallowing it silently.
          sdk.logger.warn(
            `remind_unplayed: DM to ${userId} threw: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return textResult({
        game: args.game,
        reminded,
        ...(skipped > 0 ? { skipped } : {}),
      });
    },
  );
}

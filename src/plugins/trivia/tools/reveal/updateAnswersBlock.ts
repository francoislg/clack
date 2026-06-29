import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { triviaLogger as logger } from "../../core/pluginLogger.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { getAnswerTypeHandler } from "../../answerTypes/registry.js";
import { editRevealIntoCard, editInvalidatedIntoCard } from "../../revealCards/editCard.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaDataLayer } from "../../core/types.js";
import {
  defaultRevealSlackDeps,
  resolveBotUserId,
  type RevealSlackDeps,
} from "./computeAnswers.js";
import { selectBatch } from "./batchSelection.js";

const DESCRIPTION = `Deterministically edit the already-posted trivia question card(s) for a batch into their revealed state. Reads the CURRENT \`questions.json\` + \`answers.json\` and rebuilds each card from its stored \`postedBlocks\` (drop the vote buttons, append the results footer, append the "See your answer" button). This is the SOLE editor of posted question cards.

Call this AFTER \`compute_answers\`, passing the \`batchId\` it returned. It performs NO scoring, NO freeform judging, NO season rollover, and posts NO new message — it only brings each card in line with the scored answers on disk. It is idempotent (safe to re-run) and reconciling (re-run it after a re-score to refresh a card). A per-card \`chat.update\` failure (deleted message, rate limit) is logged and does not abort the rest of the batch.

\`batchId\` accepts either a real shared batchId OR a single question's id (for legacy/undefined-batchId rows).

\`questionIds\` (optional) restricts the repaint to a SUBSET of the batch's cards. Pass it for a MID-WINDOW replay: when you invalidate one question of a still-live (unrevealed) batch, call \`update_answers_block(game, batchId, questionIds: ["<invalidated id>"])\` to repaint ONLY that card into its "❌ Invalidated" state — the live siblings keep their vote buttons untouched. Omit it during a normal reveal to repaint the whole batch.`;

export function createUpdateAnswersBlockTool(
  data: TriviaDataLayer,
  sdk: Pick<ClackSdk, "getSlackClient" | "actionId">,
  getGamesFn: GetGamesFn = defaultGetGames,
  slackDeps: RevealSlackDeps = defaultRevealSlackDeps(sdk),
  getTriviaConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
) {
  return tool(
    "update_answers_block",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe("Game name (must be present in config.trivia.games[] and not disabled)."),
      batchId: z
        .string()
        .describe(
          "The batch handle returned by compute_answers — the shared batchId of the revealed questions, or a single question's id for legacy rows.",
        ),
      questionIds: z
        .array(z.string())
        .optional()
        .describe(
          "Optional subset of question ids within the batch to repaint. Use for a mid-window replay: pass the single invalidated question's id so only its card is edited and the still-live siblings keep their vote buttons. Omit to repaint the whole batch (normal reveal).",
        ),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const unavailable = slackDeps.isAvailable();
      if (unavailable !== null) return errorResult(unavailable);

      const scoped = data.forGame(args.game);
      const allQuestions = await scoped.loadQuestions();
      let batch = selectBatch(allQuestions, args.batchId);
      if (batch.length === 0) {
        return errorResult(
          `No questions found for batchId "${args.batchId}" in game "${args.game}".`,
        );
      }

      // A mid-window replay repaints ONLY the invalidated card(s) it names, leaving
      // the batch's still-live siblings (vote buttons intact) untouched.
      if (args.questionIds !== undefined) {
        const wanted = new Set(args.questionIds);
        batch = batch.filter((q) => wanted.has(q.id));
        if (batch.length === 0) {
          return errorResult(
            `None of the requested questionIds [${args.questionIds.join(", ")}] belong to batch "${args.batchId}" in game "${args.game}".`,
          );
        }
      }

      const botUserId = await resolveBotUserId(slackDeps, "update_answers_block");

      const users = await data.loadUsers();
      const game = getGamesFn().find((g) => g.name === args.game) ?? null;
      const config = getTriviaConfigFn();

      const projectDeps = {
        scoped,
        users,
        botUserId,
        fetchMessageReactions: (channel: string, ts: string) =>
          slackDeps.fetchMessageReactions(channel, ts),
      };

      const edited: string[] = [];
      const errors: Array<{ questionId: string; error: string }> = [];
      for (const question of batch) {
        // Per-card isolation: a projection or edit failure (I/O, parse) records an
        // error and moves on — it must never abort the rest of the batch.
        try {
          // Invalidated → repaint the card as "invalidated" (no results footer). Works
          // whether it was invalidated before or after its reveal.
          if (question.invalidated === true) {
            await editInvalidatedIntoCard({
              updateMessage: (channel, ts, blocks) => slackDeps.updateMessage(channel, ts, blocks),
              question,
            });
            edited.push(question.id);
            continue;
          }
          const handler = getAnswerTypeHandler(question.answersFormat);
          // A deferred prediction with no answer key yet — leave its card untouched
          // so its vote buttons stay live for picks until it is settled and revealed.
          if (!handler.hasAnswerKey(question)) continue;
          const outcome = await handler.projectReveal(question, projectDeps);
          if (!outcome.ok) {
            errors.push({ questionId: question.id, error: outcome.error });
            continue;
          }
          await editRevealIntoCard({
            updateMessage: (channel, ts, blocks) => slackDeps.updateMessage(channel, ts, blocks),
            question,
            entry: outcome.entry,
            actionId: sdk.actionId,
            game,
            config,
          });
          edited.push(question.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(
            `update_answers_block: projecting question ${question.id} failed: ${message}`,
          );
          errors.push({ questionId: question.id, error: message });
        }
      }

      return textResult({
        game: args.game,
        batchId: args.batchId,
        edited,
        ...(errors.length > 0 ? { errors } : {}),
      });
    },
  );
}

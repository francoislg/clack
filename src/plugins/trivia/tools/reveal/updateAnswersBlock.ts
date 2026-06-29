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
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";
import {
  defaultRevealSlackDeps,
  resolveBotUserId,
  type RevealSlackDeps,
} from "./computeAnswers.js";

const DESCRIPTION = `Deterministically edit already-posted trivia question card(s) into their revealed (or invalidated) state. Reads the CURRENT \`questions.json\` + \`answers.json\` and rebuilds each NAMED card from its stored \`postedBlocks\` (drop the vote buttons, append the results footer, append the "See your answer" button). This is the SOLE editor of posted question cards.

Call this AFTER \`compute_answers\`, passing the question ids it revealed — \`reveals.map(r => r.questionId)\`. It performs NO scoring, NO freeform judging, NO season rollover, and posts NO new message — it only brings each named card in line with the scored answers on disk. It is idempotent (safe to re-run) and reconciling (re-run it after a re-score to refresh a card). A per-card \`chat.update\` failure (deleted message, rate limit) is logged and does not abort the rest.

\`questionIds\` is the set of cards to repaint, keyed by each question's own id. Every card is rebuilt INDEPENDENTLY, so name EXACTLY the cards you want changed and live siblings stay untouched: pass every \`reveals[].questionId\` for a normal full reveal, or a single id to repaint just one card (e.g. one invalidated mid-window, or one corrected by \`override_answer\`/\`settle_question\` — each mutator's \`refreshHint\` tells you the id to pass). A card whose question was invalidated (\`settle_question\` invalidate) repaints into its "❌ Invalidated" state automatically; one with no answer key yet is left untouched. Duplicate ids are de-duplicated; ids matching no question are reported in \`notFound\`.`;

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
      questionIds: z
        .array(z.string())
        .min(1)
        .describe(
          "The ids of the question cards to repaint, keyed by each question's own id. Get them from compute_answers's `reveals[].questionId` (normal reveal — pass them all) or from find_previous_questions / a mutator tool's `refreshHint` (admin fixes — pass the single corrected id). Each named card is rebuilt independently; unnamed siblings are left exactly as they are.",
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
      const byId = new Map(allQuestions.map((q) => [q.id, q]));

      // Select by id: each named card is repainted independently, unnamed siblings
      // untouched. Duplicates collapse; ids matching no row land in `notFound`.
      const batch: TriviaQuestion[] = [];
      const seen = new Set<string>();
      const notFound: string[] = [];
      for (const id of args.questionIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const question = byId.get(id);
        if (question === undefined) notFound.push(id);
        else batch.push(question);
      }
      if (batch.length === 0) {
        return errorResult(
          `No questions found for ids [${args.questionIds.join(", ")}] in game "${args.game}".`,
        );
      }
      // Repaint in posted order for deterministic card edits.
      batch.sort((a, b) => (a.postedAt ?? 0) - (b.postedAt ?? 0));

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
        edited,
        ...(notFound.length > 0 ? { notFound } : {}),
        ...(errors.length > 0 ? { errors } : {}),
      });
    },
  );
}

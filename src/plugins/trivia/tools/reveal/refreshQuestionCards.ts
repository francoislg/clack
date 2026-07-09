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
import { resolveLiveOrLockedCard } from "../../freeform/roster.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";
import {
  defaultRevealSlackDeps,
  resolveBotUserId,
  type RevealSlackDeps,
} from "./computeAnswers.js";

const DESCRIPTION = `Deterministically edit already-posted trivia question card(s) into whatever state their record is currently in. Reads the CURRENT \`questions.json\` + \`answers.json\` and rebuilds each NAMED card from its stored \`postedBlocks\`. This is the SOLE editor of posted question cards in the reveal flow.

Per card, the state is chosen from the record (first match wins):
- INVALIDATED (\`invalidated: true\`) → the "❌ Invalidated" line, no results footer.
- REVEALED (has an answer key AND \`processedAt\` is set) → drop the vote buttons, append the results footer + any authored narrative + the "See your answer" button.
- LOCKED (\`answerLocked: true\`) → the locked notice, buttons removed.
- LIVE (otherwise) → the vote/answer buttons restored from \`postedBlocks\` + the current live roster.
The results footer is NEVER painted while \`processedAt\` is unset, so a keyed-but-unrevealed card repaints live/locked and its answer stays secret.

Call this AFTER \`compute_answers\`, passing the question ids it revealed — \`reveals.map(r => r.questionId)\`. It performs NO scoring, NO freeform judging, NO season rollover, and posts NO new message — it only brings each named card in line with disk. It is idempotent (safe to re-run) and reconciling (re-run it after a re-score, an invalidate, or a reopen to refresh a card). A per-card \`chat.update\` failure (deleted message, rate limit) is logged and does not abort the rest.

\`questionIds\` is the set of cards to repaint, keyed by each question's own id. Every card is rebuilt INDEPENDENTLY, so name EXACTLY the cards you want changed and live siblings stay untouched: pass every \`reveals[].questionId\` for a normal full reveal, or a single id to repaint just one card (e.g. one invalidated mid-window, or one corrected by \`override_answer\`/\`settle_question\` — each mutator's \`refreshHint\` tells you the id to pass). A staged or legacy row with no \`postedBlocks\`/\`messageLink\` is skipped. Duplicate ids are de-duplicated; ids matching no question are reported in \`notFound\`.`;

export function createRefreshQuestionCardsTool(
  data: TriviaDataLayer,
  sdk: Pick<ClackSdk, "getSlackClient" | "actionId">,
  getGamesFn: GetGamesFn = defaultGetGames,
  slackDeps: RevealSlackDeps = defaultRevealSlackDeps(sdk),
  getTriviaConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
) {
  return tool(
    "refresh_question_cards",
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

      const botUserId = await resolveBotUserId(slackDeps, "refresh_question_cards");

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
          // State precedence (first match wins), all rebuilt from stored postedBlocks:
          //   1. invalidated → the ❌ invalidated line (no results footer).
          //   2. keyed AND processed → the revealed results footer + narrative.
          //   3. otherwise → LIVE or LOCKED (resolveLiveOrLockedCard honors answerLocked).
          // The footer is NEVER painted while processedAt is unset — a keyed-but-unrevealed
          // question repaints live/locked, so its answer stays secret.
          if (question.invalidated === true) {
            await editInvalidatedIntoCard({
              updateMessage: (channel, ts, blocks) => slackDeps.updateMessage(channel, ts, blocks),
              question,
            });
            edited.push(question.id);
            continue;
          }
          const handler = getAnswerTypeHandler(question.answersFormat);
          if (handler.hasAnswerKey(question) && question.processedAt !== undefined) {
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
            continue;
          }
          // LIVE / LOCKED — returns null (skips) for a staged/legacy row with no
          // postedBlocks/messageLink, matching the prior untouched behavior.
          const resolved = await resolveLiveOrLockedCard({ scoped, data, question, handler });
          if (resolved === null) continue;
          await slackDeps.updateMessage(resolved.channel, resolved.ts, resolved.blocks);
          edited.push(question.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(
            `refresh_question_cards: projecting question ${question.id} failed: ${message}`,
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

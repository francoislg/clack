import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import type { KnownBlock } from "@slack/types";
import { BlockSchema, type Block } from "../../../../slack/blockSchema.js";
import { validateBlocks } from "../../../../slack/blockValidate.js";
import { postStructuredMessage } from "../../../../slack/messagePoster.js";
import type { SlackBlocks } from "../../../../slack/blocks.js";
import { addDeliveryReactions } from "../../../../slack/messageReactions.js";
import { logger } from "../../../../logger.js";
import type { ClackSdk } from "../../../sdk.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";

const DESCRIPTION = `Post one or more saved trivia questions to the game's configured Slack channel and stamp postedAt/messageLink on each question record. Replaces the prior "submit_response with reactions" delivery for the question-posting flow.

Per item:
- Loads the question from games/<game>/questions.json (errors if missing).
- Posts the supplied Block Kit blocks via chat.postMessage to the channel resolved from config.trivia.games[<game>].channel.
- Fetches the message's permalink via chat.getPermalink.
- Stamps the question record with postedAt (epoch ms derived from the Slack ts), messageLink (the permalink), and batchId (see batchId section below).
- Attaches vote reactions derived from the question's stored type:
  - type "boolean" (or absent) → ["+1", "-1"].
  - type "choice" → ["one", "two", "three", "four"].slice(0, choices.length).
  Reactions are NEVER passed as arguments — the derivation is the only source.

batchId selection:
- DEFAULT (\`appendToPreviousBatch\` absent or false): the tool mints a fresh UUID once per call and stamps every freshly-posted item with it. process_reveal_answers groups questions sharing the same batchId into one reveal.
- APPEND MODE (\`appendToPreviousBatch: true\`): the tool resolves the game's most-recent batch (the batchId group whose max(postedAt) is the largest among rows that carry a batchId) and stamps every freshly-posted item with THAT batchId — joining the prior batch instead of creating a new one. Use this on a retry of items that failed in an earlier post_questions call within the same run, so the retried items reveal together with the original successes.
- APPEND MODE fails the WHOLE call atomically (no Slack posts, no record mutations) when (a) the game has no question carrying a batchId — nothing to append to, or (b) the resolved previous batch contains at least one question whose processedAt is set (the batch was already revealed). Appending to a revealed batch would resurrect a closed round.

Idempotency: a question whose postedAt is already set is skipped (returned with ok: true and the prior ts/permalink). Re-calling with the same items is a no-op. Idempotent-skip semantics are identical regardless of \`appendToPreviousBatch\`.

Block validation is performed up-front for EVERY item against Slack's per-block runtime limits (header length, section length, table shape, etc.). If ANY item's blocks fail validation, the WHOLE call is refused atomically — no Slack posts, no record mutations — and the error lists every offending field across every item. Fix all of them and retry the entire batch together; do NOT retry partial items, which would post questions out of order.

Per-item failures AFTER pre-flight validation (missing question, Slack runtime errors, etc.) are isolated: the call returns a results array with per-item { ok, ts?, permalink?, error? } so other items still process.`;

/**
 * Append a Slack `actions` block with one `Answer` button to a freeform
 * question card. `actionId` namespaces the id under `plugin:trivia:` so the
 * wildcard dispatcher routes the click back to the trivia plugin's handler.
 */
export function appendFreeformAnswerButton(
  blocks: SlackBlocks,
  actionId: (key: string) => string,
  questionId: string,
): SlackBlocks {
  return [
    ...blocks,
    {
      type: "actions",
      block_id: `freeform-answer-actions:${questionId}`,
      elements: [
        {
          type: "button",
          action_id: actionId(`freeform-answer:${questionId}`),
          text: { type: "plain_text", text: "Answer", emoji: true },
          style: "primary",
        },
      ],
    },
  ];
}

/** Derive the vote reactions for a question from its stored answers format. */
export function deriveReactions(question: TriviaQuestion): string[] {
  const answersFormat = question.answersFormat ?? "boolean";
  if (answersFormat === "boolean") {
    return ["+1", "-1"];
  }
  if (answersFormat === "freeform") {
    // Freeform answers come through a modal, not reactions.
    return [];
  }
  const choiceCount = question.choices?.length ?? 0;
  return ["one", "two", "three", "four"].slice(0, choiceCount);
}

/**
 * Convert a Slack ts string like "1779214298.489159" into epoch milliseconds.
 * Floors to integer ms — sub-ms precision is dropped (intentional; postedAt is
 * a coarse "when did this go up" stamp, not a high-precision event timestamp).
 */
function tsToPostedAt(ts: string): number {
  return Math.floor(parseFloat(ts) * 1000);
}

/**
 * Synthesize a "ts" string from a previously stored `postedAt` epoch-ms for the
 * idempotent skip result. The original Slack microseconds suffix isn't stored,
 * so we pad zeros — callers that need the exact ts re-parse `messageLink`.
 */
function postedAtToTs(postedAt: number): string {
  const seconds = Math.floor(postedAt / 1000);
  const millis = postedAt % 1000;
  return `${seconds}.${String(millis).padStart(3, "0")}000`;
}

/**
 * Resolve the "previous batch" for an append-mode call. Groups questions by
 * `batchId`, picks the group whose maximum `postedAt` is the largest, and
 * returns its batchId plus the ids in that group whose `processedAt` is set
 * (so the handler can refuse to append to an already-revealed batch).
 *
 * Returns `null` when no question carries a `batchId` — the caller treats that
 * as a hard failure for append mode (nothing to append to).
 */
function resolvePreviousBatchId(
  questions: TriviaQuestion[],
): { batchId: string; processedIds: string[] } | null {
  const groups = new Map<string, { maxPostedAt: number; processedIds: string[] }>();
  for (const q of questions) {
    if (q.batchId === undefined || q.batchId === "") continue;
    const postedAt = q.postedAt ?? 0;
    const existing = groups.get(q.batchId);
    if (existing === undefined) {
      groups.set(q.batchId, {
        maxPostedAt: postedAt,
        processedIds: q.processedAt !== undefined ? [q.id] : [],
      });
    } else {
      if (postedAt > existing.maxPostedAt) existing.maxPostedAt = postedAt;
      if (q.processedAt !== undefined) existing.processedIds.push(q.id);
    }
  }
  if (groups.size === 0) return null;
  let bestId: string | null = null;
  let bestMax = -Infinity;
  for (const [id, info] of groups) {
    if (info.maxPostedAt > bestMax) {
      bestMax = info.maxPostedAt;
      bestId = id;
    }
  }
  if (bestId === null) return null;
  const winner = groups.get(bestId);
  if (winner === undefined) return null;
  return { batchId: bestId, processedIds: winner.processedIds };
}

export interface PostQuestionsItemResult {
  questionId: string;
  ok: boolean;
  ts?: string;
  permalink?: string;
  error?: string;
}

const SLACK_UNAVAILABLE_ERROR =
  "Slack client is not available. The bot's Socket Mode session must be connected for post_questions to deliver messages.";

/**
 * Slack-touching seam. Production wraps the real Slack WebClient via the plugin SDK;
 * tests pass a fake (no need to construct a full `App["client"]`).
 *
 * `isAvailable()` returns null on success or a user-facing error message when Slack
 * is disconnected — used by the tool to short-circuit before any per-item work.
 * `postBlocks()` posts a Block Kit message and returns the Slack ts + permalink.
 * `addReactions()` attaches vote reactions; best-effort, errors logged not thrown.
 */
export interface PostQuestionsSlackDeps {
  isAvailable(): string | null;
  postBlocks(opts: { channel: string; blocks: SlackBlocks }): Promise<{
    ts: string;
    permalink: string;
  }>;
  addReactions(channel: string, ts: string, reactions: string[]): Promise<void>;
}

/** Build the production `PostQuestionsSlackDeps` by lazily resolving the Slack client from the SDK. */
export function defaultPostQuestionsSlackDeps(
  sdk: Pick<ClackSdk, "getSlackClient" | "actionId">,
): PostQuestionsSlackDeps {
  return {
    isAvailable() {
      return sdk.getSlackClient() === null ? SLACK_UNAVAILABLE_ERROR : null;
    },
    async postBlocks(opts) {
      const client = sdk.getSlackClient();
      if (!client) throw new Error("Slack client became unavailable mid-run");
      return postStructuredMessage(client, opts);
    },
    async addReactions(channel, ts, reactions) {
      const client = sdk.getSlackClient();
      if (!client) return;
      await addDeliveryReactions(client, channel, ts, reactions);
    },
  };
}

export function createPostQuestionsTool(
  data: TriviaDataLayer,
  sdk: Pick<ClackSdk, "getSlackClient" | "actionId">,
  getGamesFn: GetGamesFn = defaultGetGames,
  slackDeps: PostQuestionsSlackDeps = defaultPostQuestionsSlackDeps(sdk),
) {
  return tool(
    "post_questions",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). The channel is resolved from this game's config; do NOT pass a channel argument.",
        ),
      items: z
        .array(
          z.object({
            questionId: z
              .string()
              .describe("The trivia question ID, returned earlier by save_question."),
            blocks: z
              .array(BlockSchema)
              .min(1)
              .describe(
                "The Block Kit payload for this question's Slack message. Build the standard question card (header / warm-up section / card / closer context). Do NOT include reactions in the blocks — the tool attaches them automatically based on the question's stored type.",
              ),
          }),
        )
        .min(1)
        .describe(
          "One or more items, each pairing a saved questionId with its rendered Block Kit blocks. Each item posts its own Slack message.",
        ),
      appendToPreviousBatch: z
        .boolean()
        .optional()
        .describe(
          "When true, the tool reuses the game's most-recent batchId for every fresh item in this call instead of minting a new one. Use ONLY when retrying items that failed in an earlier post_questions call within the same run, so the retried items reveal together with the original successes. The call fails atomically (no Slack posts, no record mutations) if there is no prior batch for the game, or if the resolved previous batch contains any question whose processedAt is set (already revealed). Default false.",
        ),
    },
    async (args) => {
      let game;
      try {
        game = requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const unavailable = slackDeps.isAvailable();
      if (unavailable !== null) {
        return errorResult(unavailable);
      }

      // Pre-flight block validation across the WHOLE batch. If any item's blocks
      // violate a Slack runtime limit (header length, section length, table shape,
      // etc.), refuse the entire call atomically. Without this, a single bad item
      // would fail at chat.postMessage while its sibling items succeed; the model
      // would then retry just the failures and the questions would land out of
      // order in the channel.
      const validationDetails: string[] = [];
      for (let i = 0; i < args.items.length; i++) {
        const item = args.items[i];
        const itemErrors = validateBlocks(item.blocks as Block[]);
        for (const e of itemErrors) {
          validationDetails.push(
            `items[${i}] (questionId "${item.questionId}") ${e.field}: ${e.message}`,
          );
        }
      }
      if (validationDetails.length > 0) {
        return errorResult(
          `post_questions refused the WHOLE batch because at least one item's blocks violate Slack's runtime limits. No Slack posts were made, no question records were mutated. Fix every listed field and retry the entire batch in one call — do NOT retry partial items, which would post questions out of order.\n${validationDetails.join("\n")}`,
        );
      }

      const scoped = data.forGame(args.game);
      const results: PostQuestionsItemResult[] = [];

      // Resolve batchId. Default mode mints a fresh UUID; append mode reuses
      // the game's most-recent batch (and refuses to append to a revealed one).
      let batchId: string;
      if (args.appendToPreviousBatch === true) {
        const existingQuestions = await scoped.loadQuestions();
        const previous = resolvePreviousBatchId(existingQuestions);
        if (previous === null) {
          return errorResult(
            `appendToPreviousBatch was set but game "${args.game}" has no prior batch to append to. Drop the flag for a fresh batch, or post an initial batch first.`,
          );
        }
        if (previous.processedIds.length > 0) {
          return errorResult(
            `appendToPreviousBatch was set, but the most-recent batch (batchId "${previous.batchId}") already has at least one revealed question (e.g. "${previous.processedIds[0]}"). Appending would resurrect an already-revealed round. Drop the flag to start a fresh batch.`,
          );
        }
        batchId = previous.batchId;
      } else {
        batchId = crypto.randomUUID();
      }

      for (const item of args.items) {
        try {
          const questions = await scoped.loadQuestions();
          const question = questions.find((q) => q.id === item.questionId);
          if (question === undefined) {
            results.push({
              questionId: item.questionId,
              ok: false,
              error: `Question "${item.questionId}" not found in game "${args.game}".`,
            });
            continue;
          }

          // Idempotent skip: already posted.
          if (question.postedAt !== undefined) {
            results.push({
              questionId: item.questionId,
              ok: true,
              ts: postedAtToTs(question.postedAt),
              permalink: question.messageLink ?? "",
            });
            continue;
          }

          const baseBlocks = item.blocks as SlackBlocks;
          const blocksWithAnswerButton =
            question.answersFormat === "freeform"
              ? appendFreeformAnswerButton(baseBlocks, sdk.actionId, question.id)
              : baseBlocks;

          const { ts, permalink } = await slackDeps.postBlocks({
            channel: game.channel,
            blocks: blocksWithAnswerButton,
          });

          // Stamp the question record BEFORE attempting reactions. Reactions are
          // best-effort; the post + stamp are the durable side effects that matter.
          await scoped.updateQuestion(item.questionId, {
            postedAt: tsToPostedAt(ts),
            messageLink: permalink,
            batchId,
            postedBlocks: blocksWithAnswerButton as KnownBlock[],
          });

          const reactions = deriveReactions(question);
          if (reactions.length > 0) {
            try {
              await slackDeps.addReactions(game.channel, ts, reactions);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn(`[post_questions] reactions failed for ${item.questionId}: ${msg}`);
            }
          }

          results.push({
            questionId: item.questionId,
            ok: true,
            ts,
            permalink,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`[post_questions] item ${item.questionId} failed: ${message}`);
          results.push({
            questionId: item.questionId,
            ok: false,
            error: message,
          });
        }
      }

      return textResult({ results });
    },
  );
}

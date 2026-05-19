import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { BlockSchema } from "../../../../slack/blockSchema.js";
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
- Stamps the question record with postedAt (epoch ms derived from the Slack ts) and messageLink (the permalink).
- Attaches vote reactions derived from the question's stored type:
  - type "boolean" (or absent) → ["+1", "-1"].
  - type "choice" → ["one", "two", "three", "four"].slice(0, choices.length).
  Reactions are NEVER passed as arguments — the derivation is the only source.

Idempotency: a question whose postedAt is already set is skipped (returned with ok: true and the prior ts/permalink). Re-calling with the same items is a no-op.

Per-item failures (missing question, Slack errors, etc.) are isolated: the call returns a results array with per-item { ok, ts?, permalink?, error? } so other items still process.`;

/** Derive the vote reactions for a question from its stored type. */
export function deriveReactions(question: TriviaQuestion): string[] {
  const type = question.type ?? "boolean";
  if (type === "boolean") {
    return ["+1", "-1"];
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
  sdk: Pick<ClackSdk, "getSlackClient">,
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
  sdk: Pick<ClackSdk, "getSlackClient">,
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

      const scoped = data.forGame(args.game);
      const results: PostQuestionsItemResult[] = [];

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

          const { ts, permalink } = await slackDeps.postBlocks({
            channel: game.channel,
            blocks: item.blocks as SlackBlocks,
          });

          // Stamp the question record BEFORE attempting reactions. Reactions are
          // best-effort; the post + stamp are the durable side effects that matter.
          await scoped.updateQuestion(item.questionId, {
            postedAt: tsToPostedAt(ts),
            messageLink: permalink,
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

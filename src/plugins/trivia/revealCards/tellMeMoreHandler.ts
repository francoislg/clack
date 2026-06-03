/**
 * Single Slack action handler for the post-reveal "Tell me more" button.
 * Registered once against `^tell-me-more:[questionId]$` (the SDK auto-prefixes
 * `plugin:trivia:`), it serves every question. On click it: removes the button
 * from the shared card (global — one shared conversation), posts a localized
 * intro reply tagging the clicker, and kicks off a streamed Claude conversation
 * in the question's thread (via `sdk.startThreadConversation`) that digs into
 * the question and its answer. The thread auto-follows, so players can keep asking.
 */

import type { KnownBlock } from "@slack/types";
import type { ClackSdk } from "../../sdk.js";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import type { TriviaDataLayer } from "../core/types.js";
import { getAnswerTypeHandler } from "../answerTypes/registry.js";
import { t } from "../i18n/t.js";

/** Regex passed to `sdk.registerAction` — matches the suffix after the SDK's `plugin:trivia:` scope. */
const TELL_ME_MORE_ACTION_RE = /^tell-me-more:[^:]+$/;
/** Prefix on the FULL action_id Slack delivers at click time (after SDK scoping). */
const TELL_ME_MORE_ACTION_PREFIX = "plugin:trivia:tell-me-more:";

/** `block_id` of the dedicated actions block holding the "Tell me more" button. */
function tellMeMoreBlockId(questionId: string): string {
  return `reveal-tell-me-more-actions:${questionId}`;
}

/** Extract the questionId from a dispatched tell-me-more action_id. */
export function extractQuestionIdFromActionId(actionId: string): string | null {
  if (!actionId.startsWith(TELL_ME_MORE_ACTION_PREFIX)) return null;
  const id = actionId.slice(TELL_ME_MORE_ACTION_PREFIX.length);
  return id.length > 0 && !id.includes(":") ? id : null;
}

/** Scan every known game's `questions.json` for the owner of a questionId. */
async function findGameForQuestion(
  data: TriviaDataLayer,
  gameNames: readonly string[],
  questionId: string,
): Promise<string | null> {
  for (const name of gameNames) {
    const questions = await data.forGame(name).loadQuestions();
    if (questions.some((q) => q.id === questionId)) return name;
  }
  return null;
}

/** Narrow client surface — the handler only edits the card to drop the button. */
interface TellMeMoreSlackClient {
  chat: {
    update: (args: {
      channel: string;
      ts: string;
      blocks: KnownBlock[];
    }) => Promise<{ ok?: boolean }>;
  };
}

export interface TellMeMoreInstallDeps {
  data: TriviaDataLayer;
  getGameNames: () => string[];
}

export function installTellMeMoreHandler(
  sdk: Pick<ClackSdk, "registerAction" | "sendMessage" | "startThreadConversation"> & {
    getSlackClient: () => TellMeMoreSlackClient | null;
  },
  deps: TellMeMoreInstallDeps,
): void {
  const { data, getGameNames } = deps;
  sdk.registerAction(TELL_ME_MORE_ACTION_RE, async ({ ack, body, action }) => {
    await ack();
    const client = sdk.getSlackClient();
    if (!client) {
      logger.warn("[trivia:reveal-card] tell-me-more fired before Slack client was connected");
      return;
    }

    const actionId =
      "action_id" in action && typeof action.action_id === "string" ? action.action_id : "";
    const questionId = extractQuestionIdFromActionId(actionId);
    if (questionId === null) {
      logger.warn(`[trivia:reveal-card] unparseable tell-me-more action_id: ${actionId}`);
      return;
    }

    const channel = "channel" in body ? body.channel?.id : undefined;
    const message = "message" in body ? body.message : undefined;
    const ts = message?.ts;
    const currentBlocks = (message as { blocks?: KnownBlock[] } | undefined)?.blocks;
    const userId = "user" in body && body.user?.id ? body.user.id : null;
    if (!channel || !ts || !currentBlocks || userId === null) {
      logger.warn("[trivia:reveal-card] tell-me-more body missing channel/message/user");
      return;
    }

    // Drop just the tell-me-more actions block. If it's already gone, another
    // click already started the conversation — no-op (no duplicate intro/kickoff).
    const blockId = tellMeMoreBlockId(questionId);
    const remaining = currentBlocks.filter((b) => b.block_id !== blockId);
    if (remaining.length === currentBlocks.length) {
      logger.debug(`[trivia:reveal-card] tell-me-more already removed for ${questionId} — no-op`);
      return;
    }

    const game = await findGameForQuestion(data, getGameNames(), questionId);
    if (game === null) {
      logger.warn(`[trivia:reveal-card] no game owns question ${questionId}`);
      return;
    }
    const question = (await data.forGame(game).loadQuestions()).find((q) => q.id === questionId);
    if (!question) {
      logger.warn(`[trivia:reveal-card] question ${questionId} disappeared before tell-me-more`);
      return;
    }

    try {
      await client.chat.update({ channel, ts, blocks: remaining });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[trivia:reveal-card] tell-me-more chat.update failed for ${questionId}: ${msg}`);
      return;
    }

    await sdk.sendMessage({
      channel,
      threadTs: ts,
      text: t("tell_me_more.intro", { user: `<@${userId}>` }),
    });

    const answerLine = getAnswerTypeHandler(question.answersFormat).formatCorrectAnswer(question);
    await sdk.startThreadConversation({
      channel,
      threadTs: ts,
      userId,
      // "Tell me more" is an explicit invitation to dig in — follow the thread eagerly so
      // follow-up questions get answered without a conservative relevance gate.
      attentionLevel: "high",
      prompt:
        "Tell me more about this trivia question and its answer — share some genuinely interesting details.",
      additionalSystemPrompt: [
        'A trivia player clicked "Tell me more" after this question was revealed.',
        "Here is the question and its correct answer:",
        "",
        `Category: ${question.category}`,
        `Question: ${question.statement}`,
        `Correct answer: ${answerLine}`,
        "",
        "Share genuinely interesting, accurate background — the story behind the answer,",
        "surprising facts, useful context. Keep it lively and reasonably concise. Do not",
        "just restate the question. If the topic is recent or you are unsure, use web search.",
      ].join("\n"),
    });
  });
}

/**
 * The one-shot "Tell me more" post-game button, enabled per game/workspace via
 * the `tellMeMore` cascade. The shared installer drops its block on click; this
 * entry's `onClick` then posts a localized intro tagging the clicker and starts
 * a streamed Claude conversation in the question's thread (seeded with the
 * question + answer) that digs into the answer. The thread auto-follows at high
 * attention so players can keep asking.
 */

import { getAnswerTypeHandler } from "../answerTypes/registry.js";
import { resolveTellMeMore } from "../domain/tellMeMore.js";
import { t } from "../i18n/t.js";
import type { OneShotPostGameButton } from "./postGameButtons.js";

export const tellMeMoreButton: OneShotPostGameButton = {
  key: "tell-me-more",
  actionRe: /^tell-me-more:[^:]+$/,
  actionPrefix: "plugin:trivia:tell-me-more:",
  actionIdSuffix: (questionId) => `tell-me-more:${questionId}`,
  blockId: (questionId) => `reveal-tell-me-more-actions:${questionId}`,
  label: () => t("button.tell_me_more"),
  lifecycle: "one-shot",
  enabled: (ctx) => resolveTellMeMore(ctx.game, ctx.config).enabled,
  onClick: async (ctx) => {
    await ctx.sdk.sendMessage({
      channel: ctx.channel,
      threadTs: ctx.ts,
      text: t("tell_me_more.intro", { user: `<@${ctx.userId}>` }),
    });

    const answerLine = getAnswerTypeHandler(ctx.question.answersFormat).formatCorrectAnswer(
      ctx.question,
    );
    await ctx.sdk.startThreadConversation({
      channel: ctx.channel,
      threadTs: ctx.ts,
      userId: ctx.userId,
      // "Tell me more" is an explicit invitation to dig in — follow the thread eagerly so
      // follow-up questions get answered without a conservative relevance gate.
      attentionLevel: "high",
      prompt:
        "Tell me more about this trivia question and its answer — share some genuinely interesting details.",
      additionalSystemPrompt: [
        'A trivia player clicked "Tell me more" after this question was revealed.',
        "Here is the question and its correct answer:",
        "",
        `Category: ${ctx.question.category}`,
        `Question: ${ctx.question.statement}`,
        `Correct answer: ${answerLine}`,
        "",
        "Share genuinely interesting, accurate background — the story behind the answer,",
        "surprising facts, useful context. Keep it lively and reasonably concise. Do not",
        "just restate the question. If the topic is recent or you are unsure, use web search.",
        "",
        "This thread was intentionally opened for follow-up questions — players are expected",
        "to keep asking. Do NOT lower `attention_level` on this turn; leave it untouched so",
        "follow-ups get answered. Only disengage if the player clearly signals they're done.",
      ].join("\n"),
    });
  },
};

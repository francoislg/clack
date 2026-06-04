/**
 * The persistent "See your answer" post-game button. On click it opens a
 * read-only modal scoped to the clicking user, showing their own submission and
 * verdict (or a "did not answer" message). There is no view-submit handler — the
 * modal is read-only, so `views.open` is the whole interaction. The button is
 * never removed; players keep clicking to recall their answer.
 */

import { triviaLogger as logger } from "../core/pluginLogger.js";
import { t } from "../i18n/t.js";
import type { PersistentPostGameButton } from "./postGameButtons.js";
import { buildSeeAnswerModal } from "./seeAnswerModal.js";

export const seeAnswerButton: PersistentPostGameButton = {
  key: "see-answer",
  actionRe: /^reveal-see-answer:[^:]+$/,
  actionPrefix: "plugin:trivia:reveal-see-answer:",
  actionIdSuffix: (questionId) => `reveal-see-answer:${questionId}`,
  blockId: (questionId) => `reveal-see-answer-actions:${questionId}`,
  label: () => t("button.see_your_answer"),
  lifecycle: "persistent",
  enabled: () => true,
  onClick: async (ctx) => {
    const triggerId = ctx.body.trigger_id;
    if (triggerId === undefined) {
      logger.warn("[trivia:reveal-card] action body missing trigger_id; cannot open modal");
      return;
    }
    const userId = ctx.body.user?.id;
    if (userId === undefined) {
      logger.warn("[trivia:reveal-card] action body missing user; cannot scope answer");
      return;
    }

    const myRow = (await ctx.scoped.loadAnswers()).find(
      (a) => a.userId === userId && a.questionId === ctx.questionId,
    );
    const view = buildSeeAnswerModal({ question: ctx.question, myRow });
    await ctx.client.views.open({ trigger_id: triggerId, view });
  },
};

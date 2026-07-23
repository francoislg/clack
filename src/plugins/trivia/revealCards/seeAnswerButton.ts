/**
 * The persistent "See your answer" post-game button. On click it opens a
 * read-only modal scoped to the clicking user, showing their own submission and
 * verdict (or a "did not answer" message). There is no view-submit handler — the
 * modal is read-only, so `views.open` is the whole interaction. The button is
 * never removed; players keep clicking to recall their answer.
 */

import { triviaLogger as logger } from "../core/pluginLogger.js";
import { t } from "../i18n/t.js";
import { buildTeamIndexByUser } from "../domain/teams/computeTeamStandings.js";
import { projectTeamSlotToRow } from "../answering/byTeam.js";
import type { PersistentPostGameButton } from "./postGameButtons.js";
import { buildSeeAnswerModal } from "./seeAnswerModal.js";

export const seeAnswerButton: PersistentPostGameButton = {
  key: "see-answer",
  actionRe: /^reveal-see-answer:[^:]+$/,
  actionPrefix: "plugin:trivia:reveal-see-answer:",
  actionIdSuffix: (questionId) => `reveal-see-answer:${questionId}`,
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

    // Shared-buzzer: a stamped-roster member sees the TEAM's slot (attribution
    // suppressed — `projectTeamSlotToRow` drops `lastAnsweredBy`). Free agents and
    // individual-mode players see their own row.
    const roster =
      ctx.question.answeringType === "byTeam" ? (ctx.question.teamsStamp?.teams ?? []) : [];
    const teamIndex = buildTeamIndexByUser(roster).get(userId);
    let myRow;
    if (teamIndex !== undefined) {
      const teamName = roster[teamIndex].name;
      const slot = (await ctx.scoped.loadTeamAnswers()).find(
        (s) => s.teamName === teamName && s.questionId === ctx.questionId,
      );
      myRow = slot === undefined ? undefined : projectTeamSlotToRow(slot);
    } else {
      myRow = (await ctx.scoped.loadAnswers()).find(
        (a) => a.userId === userId && a.questionId === ctx.questionId,
      );
    }
    const view = buildSeeAnswerModal({ question: ctx.question, myRow });
    await ctx.client.views.open({ trigger_id: triggerId, view });
  },
};

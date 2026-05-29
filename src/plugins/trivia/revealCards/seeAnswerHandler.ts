/**
 * Single Slack action handler for the post-reveal "See your answer" button.
 * Registered once against `^reveal-see-answer:[questionId]$` (the SDK auto-
 * prefixes `plugin:trivia:`), it serves every question. On click it locates the
 * owning game, loads the clicking user's row, and opens a read-only modal
 * scoped to that user. There is no view-submit handler — the modal is
 * read-only, so `views.open` is the whole interaction.
 */

import type { ModalView, ViewsOpenResponse } from "@slack/web-api";
import type { ClackSdk } from "../../sdk.js";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import type { TriviaDataLayer } from "../core/types.js";
import { buildSeeAnswerModal } from "./seeAnswerModal.js";

/** Regex passed to `sdk.registerAction` — matches the suffix after the SDK's `plugin:trivia:` scope. */
const SEE_ANSWER_ACTION_RE = /^reveal-see-answer:[^:]+$/;
/** Prefix on the FULL action_id Slack delivers at click time (after SDK scoping). */
const SEE_ANSWER_ACTION_PREFIX = "plugin:trivia:reveal-see-answer:";

/** Extract the questionId from a dispatched see-answer action_id. */
export function extractQuestionIdFromActionId(actionId: string): string | null {
  if (!actionId.startsWith(SEE_ANSWER_ACTION_PREFIX)) return null;
  const id = actionId.slice(SEE_ANSWER_ACTION_PREFIX.length);
  return id.length > 0 && !id.includes(":") ? id : null;
}

/** Scan every known game's `questions.json` for the owner of a questionId. */
async function findGameForQuestion(
  data: TriviaDataLayer,
  gameNames: readonly string[],
  questionId: string,
): Promise<string | null> {
  for (const name of gameNames) {
    const scoped = data.forGame(name);
    const questions = await scoped.loadQuestions();
    if (questions.some((q) => q.id === questionId)) return name;
  }
  return null;
}

/** Narrow client surface — the handler only opens a modal. */
interface SeeAnswerSlackClient {
  views: { open: (args: { trigger_id: string; view: ModalView }) => Promise<ViewsOpenResponse> };
}

export interface SeeAnswerInstallDeps {
  data: TriviaDataLayer;
  getGameNames: () => string[];
}

export function installSeeAnswerHandler(
  sdk: Pick<ClackSdk, "registerAction"> & {
    getSlackClient: () => SeeAnswerSlackClient | null;
  },
  deps: SeeAnswerInstallDeps,
): void {
  const { data, getGameNames } = deps;
  sdk.registerAction(SEE_ANSWER_ACTION_RE, async ({ ack, body, action }) => {
    await ack();
    const client = sdk.getSlackClient();
    if (!client) {
      logger.warn("[trivia:reveal-card] see-answer fired before Slack client was connected");
      return;
    }

    const actionId =
      "action_id" in action && typeof action.action_id === "string" ? action.action_id : "";
    const questionId = extractQuestionIdFromActionId(actionId);
    if (questionId === null) {
      logger.warn(`[trivia:reveal-card] unparseable see-answer action_id: ${actionId}`);
      return;
    }

    if (!("trigger_id" in body) || typeof body.trigger_id !== "string") {
      logger.warn("[trivia:reveal-card] action body missing trigger_id; cannot open modal");
      return;
    }
    if (!("user" in body) || typeof body.user !== "object" || body.user === null) {
      logger.warn("[trivia:reveal-card] action body missing user; cannot scope answer");
      return;
    }
    const userObj = body.user;
    const userId =
      "id" in userObj && typeof (userObj as { id: unknown }).id === "string"
        ? (userObj as { id: string }).id
        : null;
    if (userId === null) {
      logger.warn("[trivia:reveal-card] action body user object missing id");
      return;
    }

    const game = await findGameForQuestion(data, getGameNames(), questionId);
    if (game === null) {
      logger.warn(`[trivia:reveal-card] no game owns question ${questionId}`);
      return;
    }

    const scoped = data.forGame(game);
    const question = (await scoped.loadQuestions()).find((q) => q.id === questionId);
    if (!question) {
      logger.warn(
        `[trivia:reveal-card] question ${questionId} disappeared between resolve and open`,
      );
      return;
    }

    const myRow = (await scoped.loadAnswers()).find(
      (a) => a.userId === userId && a.questionId === questionId,
    );

    const view = buildSeeAnswerModal({ question, myRow });
    await client.views.open({ trigger_id: body.trigger_id, view });
  });
}

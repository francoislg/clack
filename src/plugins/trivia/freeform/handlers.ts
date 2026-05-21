import type { ClackSdk } from "../../sdk.js";
import type { TriviaDataLayer } from "../core/types.js";
import { logger } from "../../../logger.js";
import { buildFreeformModal, readAnswerTextFromSubmission, readModalMetadata } from "./modal.js";
import { editRosterIntoCard } from "./roster.js";

function extractQuestionIdFromActionId(actionId: string): string | null {
  const prefix = "plugin:trivia:freeform-answer:";
  if (!actionId.startsWith(prefix)) return null;
  const id = actionId.slice(prefix.length);
  return id.length > 0 ? id : null;
}

// Questions are partitioned per-game on disk, but the action_id only carries
// the questionId — scan every known game to find the owner.
async function findGameForQuestion(
  data: TriviaDataLayer,
  gameNames: string[],
  questionId: string,
): Promise<string | null> {
  for (const name of gameNames) {
    const scoped = data.forGame(name);
    const questions = await scoped.loadQuestions();
    if (questions.some((q) => q.id === questionId)) return name;
  }
  return null;
}

export interface FreeformHandlerDeps {
  data: TriviaDataLayer;
  sdk: ClackSdk;
  getGameNames: () => string[];
}

export function registerFreeformHandlers(deps: FreeformHandlerDeps): void {
  const { data, sdk, getGameNames } = deps;

  sdk.registerAction(/^freeform-answer:[^:]+$/, async ({ ack, body, action }) => {
    await ack();
    const client = sdk.getSlackClient();
    if (!client) {
      logger.warn("[trivia:freeform] action fired before Slack client was connected");
      return;
    }
    const actionId =
      "action_id" in action && typeof action.action_id === "string" ? action.action_id : "";
    const questionId = extractQuestionIdFromActionId(actionId);
    if (questionId === null) {
      logger.warn(`[trivia:freeform] action with unparseable action_id: ${actionId}`);
      return;
    }
    if (!("trigger_id" in body) || typeof body.trigger_id !== "string") {
      logger.warn("[trivia:freeform] action body missing trigger_id; cannot open modal");
      return;
    }
    if (!("user" in body) || typeof body.user !== "object" || body.user === null) {
      logger.warn("[trivia:freeform] action body missing user; cannot scope answer");
      return;
    }
    const userObj = body.user;
    const userId =
      "id" in userObj && typeof (userObj as { id: unknown }).id === "string"
        ? (userObj as { id: string }).id
        : null;
    if (userId === null) {
      logger.warn("[trivia:freeform] action body user object missing id");
      return;
    }

    const game = await findGameForQuestion(data, getGameNames(), questionId);
    if (game === null) {
      logger.warn(`[trivia:freeform] no game owns question ${questionId}`);
      return;
    }

    const scoped = data.forGame(game);
    const questions = await scoped.loadQuestions();
    const question = questions.find((q) => q.id === questionId);
    if (!question) {
      logger.warn(`[trivia:freeform] question ${questionId} disappeared between resolve and open`);
      return;
    }

    const answers = await scoped.loadAnswers();
    const myRow = answers.find((a) => a.userId === userId && a.questionId === questionId);
    const locked = question.processedAt !== undefined;

    const view = buildFreeformModal({
      callbackId: sdk.viewCallbackId(`freeform-modal:${questionId}`),
      question,
      game,
      locked,
      pendingAnswer: locked ? undefined : myRow?.answerText,
      lockedRow:
        locked && myRow !== undefined
          ? { answerText: myRow.answerText ?? "", correct: myRow.correct }
          : undefined,
    });

    await client.views.open({
      trigger_id: body.trigger_id,
      view,
    });
  });

  sdk.registerView(/^freeform-modal:[^:]+$/, async ({ ack, body, view }) => {
    const meta = readModalMetadata(view.private_metadata);
    if (meta === null) {
      await ack({
        response_action: "errors",
        errors: { [Object.keys(view.state.values)[0] ?? ""]: "internal error — invalid modal" },
      });
      logger.warn("[trivia:freeform] view-submit with unparseable private_metadata");
      return;
    }

    const text = readAnswerTextFromSubmission(view);
    if (text.length === 0) {
      await ack({
        response_action: "errors",
        errors: { "freeform-answer-input": "Type an answer before submitting." },
      });
      return;
    }

    const scoped = data.forGame(meta.game);
    const questions = await scoped.loadQuestions();
    const question = questions.find((q) => q.id === meta.questionId);
    if (!question) {
      await ack({
        response_action: "errors",
        errors: { "freeform-answer-input": "This question no longer exists." },
      });
      return;
    }

    if (question.processedAt !== undefined) {
      await ack({
        response_action: "errors",
        errors: { "freeform-answer-input": "Answers are now closed for this question." },
      });
      return;
    }

    const userId = body.user.id;
    const displayName = body.user.name ?? userId;
    const existing = (await scoped.loadAnswers()).find(
      (a) => a.userId === userId && a.questionId === meta.questionId,
    );

    if (existing) {
      await scoped.updateAnswer(userId, meta.questionId, {
        answerText: text,
        timestamp: Date.now(),
      });
    } else {
      await scoped.saveAnswer({
        userId,
        questionId: meta.questionId,
        answerText: text,
        timestamp: Date.now(),
        ...(question.season !== undefined ? { season: question.season } : {}),
      });
      const users = await data.loadUsers();
      if (!users.has(userId)) {
        await data.saveUser({ userId, displayName, joinedAt: Date.now() });
      }
    }

    await ack();

    const client = sdk.getSlackClient();
    if (client !== null) {
      await editRosterIntoCard({ client, scoped, question });
    } else {
      logger.warn(
        "[trivia:freeform] roster update skipped — Slack client unavailable after view-submit",
      );
    }
  });
}

import { z } from "zod";
import type { ClackSdk } from "../../sdk.js";
import type { SlackBlocks } from "../../../slack/blocks.js";
import type { JsonValue, TriviaFreeformAnswerShape } from "../core/configTypes.js";
import type {
  SubmittedAnswer,
  TriviaDataLayer,
  TriviaQuestion,
  TriviaUser,
} from "../core/types.js";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import { t } from "../i18n/t.js";
import { resolveFreeformAnswerShape } from "../domain/freeformAnswerShape.js";
import { weightedPick } from "../domain/weightedPick.js";
import {
  buildJudgePrompt,
  parseJudgeResponse,
  DEFAULT_JUDGE_MODEL,
  type JudgeVerdict,
} from "../freeform/judge.js";
import {
  buildFreeformModal,
  readAnswerTextFromSubmission,
  readModalMetadata,
} from "../freeform/modal.js";
import { editRosterIntoCard } from "../freeform/roster.js";
import { makeRevealOutcome } from "./revealOutcome.js";
import type {
  AnswerTypeHandler,
  GetSavedQuestionOutcome,
  InteractionRegistrationDeps,
  ProcessRevealDeps,
  ProcessRevealOutcome,
  RevealAnswerDescriptor,
  SaveQuestionArgs,
  SaveValidationContext,
  SuggestionRollDeps,
  TriviaQuestionBase,
} from "./types.js";
import type { VoterBuckets } from "../tools/reveal/types.js";

/**
 * Per-format Zod field-fragment for `save_question`. Spread into the tool's
 * input schema at module load by the registry.
 */
export const FREEFORM_SAVE_FIELDS = {
  expectedAnswer: z
    .string()
    .optional()
    .describe(
      'REQUIRED for freeform questions: the canonical answer (shortest 100%-correct form). MUST NOT be set when answersFormat is "boolean" or "choice".',
    ),
  acceptableAnswers: z
    .array(z.string())
    .optional()
    .describe(
      'OPTIONAL on freeform questions: pre-enumerated semantic variants the judge should also accept. MUST NOT be set when answersFormat is "boolean" or "choice".',
    ),
  gradingNotes: z
    .string()
    .optional()
    .describe(
      'OPTIONAL on freeform questions: a one-sentence hint to the reveal-time judge about edge cases (e.g. "Accept any major Canadian city"). MUST NOT be set when answersFormat is "boolean" or "choice".',
    ),
  freeformAnswerShape: z
    .enum(["name", "place", "phrase", "title", "date", "countable", "other"])
    .optional()
    .describe(
      'REQUIRED for freeform questions: the shape `get_ideas` rolled in `suggestedFreeformAnswerShape` — pass it through verbatim, do NOT re-pick. Persisted for post-hoc audit. MUST NOT be set when answersFormat is "boolean" or "choice".',
    ),
} as const;

/** Truncate freeform answer text for the roster label to keep the footer scannable. */
const ROSTER_LABEL_MAX_CHARS = 40;

/** Built-in fallback when no freeformAnswerShape weights are configured. */
const DEFAULT_FREEFORM_PICK: TriviaFreeformAnswerShape = "name";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Extract the questionId from a freeform-answer action_id. */
function extractQuestionIdFromActionId(actionId: string): string | null {
  const prefix = "plugin:trivia:freeform-answer:";
  if (!actionId.startsWith(prefix)) return null;
  const id = actionId.slice(prefix.length);
  return id.length > 0 ? id : null;
}

/** Scan every known game for the owner of a questionId. */
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

export const freeformAnswerHandler: AnswerTypeHandler = {
  actionAffordanceDescription:
    'answersFormat "freeform" → a primary "Answer" button that opens a Slack modal for the user to type their answer.',
  revealAnswerShapeDescription:
    '`{ type: "freeform", expectedAnswer, acceptableAnswers?, gradingNotes? }` for freeform questions.',
  historyResultShapeDescription:
    'Freeform: `{ answersFormat: "freeform", questionType, expectedAnswer, acceptableAnswers?, gradingNotes?, cheaterUserIds, responses: Array<{ userId, displayName, answerText, correct?, judgeReason? }> }`',

  appendActionsBlock(
    blocks: SlackBlocks,
    actionId: (key: string) => string,
    question: TriviaQuestion,
  ): SlackBlocks {
    return [
      ...blocks,
      {
        type: "actions",
        block_id: `freeform-answer-actions:${question.id}`,
        elements: [
          {
            type: "button",
            action_id: actionId(`freeform-answer:${question.id}`),
            text: { type: "plain_text", text: t("button.answer"), emoji: true },
            style: "primary",
          },
        ],
      },
    ];
  },

  rosterGroupKey(answer: SubmittedAnswer): string | null {
    if (typeof answer.answerText !== "string") return null;
    return answer.answerText.trim().toLowerCase();
  },

  rosterGroupLabel(group): string {
    const sample = group.rows[0]?.answerText;
    const source = sample && sample.length > 0 ? sample : group.groupKey;
    return `"${truncate(source.trim(), ROSTER_LABEL_MAX_CHARS)}"`;
  },

  buildRevealAnswer(question: TriviaQuestion) {
    const answer: RevealAnswerDescriptor = {
      type: "freeform",
      expectedAnswer: question.expectedAnswer ?? "",
    };
    if (question.acceptableAnswers !== undefined) {
      answer.acceptableAnswers = question.acceptableAnswers;
    }
    if (question.gradingNotes !== undefined) {
      answer.gradingNotes = question.gradingNotes;
    }
    return answer;
  },

  async processReveal(
    question: TriviaQuestion,
    deps: ProcessRevealDeps,
  ): Promise<ProcessRevealOutcome> {
    if (deps.isReprocessMode) {
      return {
        ok: false,
        error:
          "reprocess mode is not supported for freeform questions (no upstream click stream to re-derive from)",
      };
    }
    if (!question.messageLink) {
      return { ok: false, error: "freeform question is missing messageLink" };
    }

    const allAnswers = await deps.scoped.loadAnswers();
    const pendingRows = allAnswers.filter(
      (a) => a.questionId === question.id && a.correct === undefined,
    );
    const submissions = pendingRows.map((row, i) => ({
      key: `1.${i + 1}`,
      userId: row.userId,
      answerText: row.answerText ?? "",
    }));

    let verdicts: JudgeVerdict[] = [];
    let judgeFailed = false;
    if (submissions.length > 0) {
      const prompt = buildJudgePrompt([{ question, submissions }]);
      try {
        const response = await deps.askClaude({
          model: DEFAULT_JUDGE_MODEL,
          system: prompt.system,
          messages: prompt.messages,
          max_tokens: 1500,
        });
        verdicts = parseJudgeResponse(response.text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[trivia:freeform] judge call/parse failed: ${msg}`);
        judgeFailed = true;
      }
    }
    const verdictByKey = new Map<string, JudgeVerdict>();
    for (const v of verdicts) verdictByKey.set(v.key, v);

    const correctVoters: Array<{ userId: string; displayName: string; answerText: string }> = [];
    const incorrectVoters: Array<{ userId: string; displayName: string; answerText: string }> = [];

    for (const sub of submissions) {
      let verdict = verdictByKey.get(sub.key);
      if (verdict === undefined) {
        verdict = {
          key: sub.key,
          correct: false,
          reason: judgeFailed ? "judge-error" : "judge-missing-verdict",
        };
      }
      await deps.scoped.updateAnswer(sub.userId, question.id, {
        correct: verdict.correct,
        ...(verdict.reason !== undefined ? { judgeReason: verdict.reason } : {}),
      });
      const displayName = deps.users.get(sub.userId)?.displayName ?? sub.userId;
      const target = verdict.correct ? correctVoters : incorrectVoters;
      target.push({ userId: sub.userId, displayName, answerText: sub.answerText });
    }

    await deps.scoped.updateQuestion(question.id, { processedAt: deps.now });

    if (judgeFailed && submissions.length > 0) {
      return {
        ok: false,
        error:
          "freeform judge call failed — submissions committed as incorrect (reason: judge-error)",
      };
    }

    const voters = buildFreeformVoters(question, correctVoters, incorrectVoters);
    return makeRevealOutcome(
      question,
      freeformAnswerHandler.buildRevealAnswer(question),
      voters,
      false,
    );
  },

  getSavedQuestion(
    base: TriviaQuestionBase,
    args: SaveQuestionArgs,
    _ctx: SaveValidationContext,
  ): GetSavedQuestionOutcome {
    if (args.expectedAnswer === undefined || args.expectedAnswer.trim().length === 0) {
      return {
        ok: false,
        error: 'Freeform questions require "expectedAnswer" (the canonical correct answer).',
      };
    }
    if (args.expectedAnswer.length > 200) {
      return {
        ok: false,
        error: `"expectedAnswer" must be at most 200 characters (got ${args.expectedAnswer.length}).`,
      };
    }
    if (args.acceptableAnswers !== undefined) {
      for (let i = 0; i < args.acceptableAnswers.length; i++) {
        const trimmed = args.acceptableAnswers[i].trim();
        if (trimmed.length < 1 || trimmed.length > 200) {
          return {
            ok: false,
            error: `acceptableAnswers[${i}] must be 1-200 characters after trim (got ${trimmed.length}).`,
          };
        }
      }
    }
    if (args.gradingNotes !== undefined && args.gradingNotes.length > 500) {
      return {
        ok: false,
        error: `"gradingNotes" must be at most 500 characters (got ${args.gradingNotes.length}).`,
      };
    }
    if (args.freeformAnswerShape === undefined) {
      return {
        ok: false,
        error:
          'Freeform questions require "freeformAnswerShape" — pass through the value from get_ideas\' suggestedFreeformAnswerShape.',
      };
    }
    return {
      ok: true,
      question: {
        ...base,
        expectedAnswer: args.expectedAnswer,
        ...(args.acceptableAnswers !== undefined
          ? { acceptableAnswers: args.acceptableAnswers }
          : {}),
        ...(args.gradingNotes !== undefined ? { gradingNotes: args.gradingNotes } : {}),
        freeformAnswerShape: args.freeformAnswerShape,
      },
    };
  },

  rollGenerationSuggestions(deps: SuggestionRollDeps): Record<string, JsonValue> {
    const weights = resolveFreeformAnswerShape(
      deps.currentSeason,
      deps.slotIndex,
      deps.game,
      deps.config,
    );
    const picked: TriviaFreeformAnswerShape = weightedPick(weights) ?? DEFAULT_FREEFORM_PICK;
    return { suggestedFreeformAnswerShape: picked };
  },

  buildHistoryResult(
    question: TriviaQuestion,
    matching: readonly SubmittedAnswer[],
    users: ReadonlyMap<string, TriviaUser>,
  ): JsonValue {
    const responses = matching.map((a) => {
      const entry: {
        userId: string;
        displayName: string;
        answerText: string;
        correct?: boolean;
        judgeReason?: string;
      } = {
        userId: a.userId,
        displayName: users.get(a.userId)?.displayName ?? a.userId,
        answerText: a.answerText ?? "",
      };
      if (a.correct !== undefined) entry.correct = a.correct;
      if (a.judgeReason !== undefined) entry.judgeReason = a.judgeReason;
      return entry;
    });
    const out: { [k: string]: JsonValue } = {
      answersFormat: "freeform",
      expectedAnswer: question.expectedAnswer ?? "",
      responses,
    };
    if (question.acceptableAnswers !== undefined) {
      out.acceptableAnswers = question.acceptableAnswers;
    }
    if (question.gradingNotes !== undefined) {
      out.gradingNotes = question.gradingNotes;
    }
    return out;
  },

  buildSearchResult(_question: TriviaQuestion): Record<string, JsonValue> {
    return {};
  },

  registerInteractions(sdk: ClackSdk, deps: InteractionRegistrationDeps): void {
    const { data, getGameNames } = deps;

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
        logger.warn(
          `[trivia:freeform] question ${questionId} disappeared between resolve and open`,
        );
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
          errors: { "freeform-answer-input": t("error.empty_answer") },
        });
        return;
      }

      const scoped = data.forGame(meta.game);
      const questions = await scoped.loadQuestions();
      const question = questions.find((q) => q.id === meta.questionId);
      if (!question) {
        await ack({
          response_action: "errors",
          errors: { "freeform-answer-input": t("error.question_gone") },
        });
        return;
      }

      if (question.processedAt !== undefined) {
        await ack({
          response_action: "errors",
          errors: { "freeform-answer-input": t("error.answers_closed_question") },
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
        await editRosterIntoCard({
          client,
          scoped,
          question,
          handler: freeformAnswerHandler,
        });
      } else {
        logger.warn(
          "[trivia:freeform] roster update skipped — Slack client unavailable after view-submit",
        );
      }
    });
  },
};

/**
 * Assemble the discriminated `VoterBuckets` variant for a freeform reveal.
 * Strips `answerText` when `revealResponses === "just-correctness"`; reduces
 * the missers to a count (winners keep `answerText`) when `"just-winners"`;
 * drops the named buckets entirely when `"no"`. Reactions stay empty — the
 * freeform path doesn't fetch reactions today (could be added later).
 */
function buildFreeformVoters(
  question: TriviaQuestion,
  correctVoters: Array<{ userId: string; displayName: string; answerText: string }>,
  incorrectVoters: Array<{ userId: string; displayName: string; answerText: string }>,
): VoterBuckets {
  const mode = question.revealResponses ?? "yes";
  if (mode === "no") {
    return { revealResponses: "no", reactions: [] };
  }
  if (mode === "just-winners") {
    return {
      revealResponses: "just-winners",
      correct: correctVoters,
      incorrectCount: incorrectVoters.length,
      noAnswerCount: 0,
      reactions: [],
    };
  }
  if (mode === "just-correctness") {
    return {
      revealResponses: "just-correctness",
      correct: correctVoters.map(({ userId, displayName }) => ({ userId, displayName })),
      incorrect: incorrectVoters.map(({ userId, displayName }) => ({ userId, displayName })),
      noAnswer: [],
      reactions: [],
    };
  }
  return {
    revealResponses: "yes",
    correct: correctVoters,
    incorrect: incorrectVoters,
    noAnswer: [],
    reactions: [],
  };
}

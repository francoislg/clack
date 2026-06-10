import { z } from "zod";
import type { ClackSdk } from "../../sdk.js";
import type { SlackBlocks } from "../../../slack/blocks.js";
import type { JsonValue } from "../core/configTypes.js";
import { DEFAULT_JUDGE_LENIENCY } from "../core/configTypes.js";
import type {
  SubmittedAnswer,
  TriviaDataLayer,
  TriviaQuestion,
  TriviaUser,
} from "../core/types.js";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import { t } from "../i18n/t.js";
import { resolveCascade } from "../domain/resolveCascade.js";
import { weightedPick } from "../domain/weightedPick.js";
import { judgeSubmissions, type JudgeSubmission } from "../freeform/judge.js";
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
  ProjectRevealDeps,
  RevealAnswerDescriptor,
  SaveQuestionArgs,
  SaveValidationContext,
  SettleOutcomeInput,
  SettleOutcomeResult,
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
  reprocessReStampAxes: ["revealResponses", "judgeLeniency"],
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

  hasAnswerKey(question: TriviaQuestion): boolean {
    return question.expectedAnswer !== undefined;
  },

  composeStatic(
    base: TriviaQuestionBase,
    args: SaveQuestionArgs,
    ctx: SaveValidationContext,
  ): GetSavedQuestionOutcome {
    // Static fields only: the answer shape + the judge-leniency policy in effect when
    // the question was posed. The canonical answer + accepted variants + grading notes
    // are answer-related and arrive via `settleOutcome`.
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
        freeformAnswerShape: args.freeformAnswerShape,
        ...(ctx.resolvedJudgeLeniency !== DEFAULT_JUDGE_LENIENCY
          ? { judgeLeniency: ctx.resolvedJudgeLeniency }
          : {}),
      },
    };
  },

  settleInputFromSaveArgs(args: SaveQuestionArgs): SettleOutcomeInput {
    return {
      outcome: args.expectedAnswer,
      acceptableAnswers: args.acceptableAnswers,
      gradingNotes: args.gradingNotes,
    };
  },

  settleOutcome(_q: TriviaQuestion, input: SettleOutcomeInput): SettleOutcomeResult {
    if (
      input.outcome === undefined ||
      (typeof input.outcome === "string" && input.outcome.trim().length === 0)
    ) {
      return {
        ok: false,
        error: 'Freeform questions require "expectedAnswer" (the canonical correct answer).',
      };
    }
    if (typeof input.outcome !== "string") {
      return { ok: false, error: "Freeform answer must be the canonical answer text." };
    }
    const expectedAnswer = input.outcome.trim();
    // The answer-related judge spec (canonical answer + accepted variants + grading
    // notes) is prepared HERE — immediately at save for a non-prediction, later at
    // settle for a prediction — the reveal judge needs the full spec.
    const extrasError = validateFreeformAnswerExtras(input.acceptableAnswers, input.gradingNotes);
    if (extrasError !== null) return { ok: false, error: extrasError };
    if (expectedAnswer.length > 200) {
      return {
        ok: false,
        error: `"expectedAnswer" must be at most 200 characters (got ${expectedAnswer.length}).`,
      };
    }
    const keyPatch: Partial<TriviaQuestion> = { expectedAnswer };
    if (input.acceptableAnswers !== undefined) keyPatch.acceptableAnswers = input.acceptableAnswers;
    if (input.gradingNotes !== undefined) keyPatch.gradingNotes = input.gradingNotes;
    return { ok: true, keyPatch, resolvedOutcome: expectedAnswer };
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

  formatCorrectAnswer(question: TriviaQuestion): string {
    return question.expectedAnswer ?? "";
  },

  async processReveal(
    question: TriviaQuestion,
    deps: ProcessRevealDeps,
  ): Promise<ProcessRevealOutcome> {
    if (!question.messageLink) {
      return { ok: false, error: "freeform question is missing messageLink" };
    }

    const allAnswers = await deps.scoped.loadAnswers();
    const ownRows = allAnswers.filter((a) => a.questionId === question.id);

    // Reprocess re-judges EVERY retained answer under the (re-stamped) judgeLeniency,
    // overwriting each verdict in place; default reveal judges only the never-judged
    // rows. The typed `answerText` is the canonical record and is never touched.
    // A hand-overridden row (originalVerdict set) is admin-authoritative — never re-judged.
    const rowsToJudge = deps.isReprocessMode
      ? ownRows.filter((a) => a.originalVerdict === undefined)
      : ownRows.filter((a) => a.correct === undefined);
    const submissions: JudgeSubmission[] = rowsToJudge.map((row) => ({
      userId: row.userId,
      answerText: row.answerText ?? "",
    }));

    // Judge each answer on its own call (no batch keys to mismatch) with a
    // re-ask budget, so the old "judge-missing-verdict" silent-wrong path is
    // gone. A row whose retries are all exhausted comes back null — we leave it
    // pending (never scored wrong) and report the failure instead.
    const judged =
      submissions.length > 0
        ? await judgeSubmissions(deps.askClaude, question, submissions, { logger })
        : [];

    let unjudgedCount = 0;

    for (const { submission, verdict } of judged) {
      if (verdict === null) {
        // No verdict after retries: leave the row's existing value untouched and
        // report it — a re-reveal re-picks it (default by correct === undefined,
        // reprocess by re-judging every row).
        unjudgedCount++;
        continue;
      }
      // Always write judgeReason so a re-judge overwrites any stale prior reason
      // (undefined clears it); on a fresh judge with no reason this is a no-op.
      await deps.scoped.updateAnswer(submission.userId, question.id, {
        correct: verdict.correct,
        judgeReason: verdict.reason,
      });
    }

    if (unjudgedCount > 0) {
      // Don't stamp processedAt: the still-pending rows can be recovered by
      // re-running the reveal, which re-judges only the unscored submissions.
      return {
        ok: false,
        error: `freeform judge could not score ${unjudgedCount} submission(s) after retries — left pending for re-reveal`,
      };
    }

    await deps.scoped.updateQuestion(question.id, { processedAt: deps.now });

    return freeformAnswerHandler.projectReveal(question, deps);
  },

  async projectReveal(
    question: TriviaQuestion,
    deps: ProjectRevealDeps,
  ): Promise<ProcessRevealOutcome> {
    if (!question.messageLink) {
      return { ok: false, error: "freeform question is missing messageLink" };
    }

    // Build voter buckets from ALL already-scored rows (correct !== undefined),
    // not just rows judged in a single pass — so re-projection after a partial
    // judge run still shows every scored submission. Freeform carries no Slack
    // reactions and no no-answer bucket (modal-only), matching buildFreeformVoters.
    const allAnswers = await deps.scoped.loadAnswers();
    const correctVoters: Array<{ userId: string; displayName: string; answerText: string }> = [];
    const incorrectVoters: Array<{ userId: string; displayName: string; answerText: string }> = [];
    for (const row of allAnswers) {
      if (row.questionId !== question.id || row.correct === undefined) continue;
      const voter = {
        userId: row.userId,
        displayName: deps.users.get(row.userId)?.displayName ?? row.userId,
        answerText: row.answerText ?? "",
      };
      (row.correct ? correctVoters : incorrectVoters).push(voter);
    }

    const voters = buildFreeformVoters(question, correctVoters, incorrectVoters);
    return makeRevealOutcome(
      question,
      freeformAnswerHandler.buildRevealAnswer(question),
      voters,
      false,
    );
  },

  formatSubmittedAnswer(_question: TriviaQuestion, row: SubmittedAnswer): string {
    return row.answerText ?? "";
  },

  rollGenerationSuggestions(deps: SuggestionRollDeps): Record<string, JsonValue> {
    // `freeformAnswerShape` is freeform-specific, so the freeform handler owns the roll —
    // but it resolves through the canonical `resolveCascade` (NOT a legacy per-axis
    // resolver), so the rolled weights match what `explain_cascade` reports.
    const weights = resolveCascade("freeformAnswerShape", deps.cascadeCtx).value;
    return { suggestedFreeformAnswerShape: weightedPick(weights) ?? "name" };
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
          data,
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

/**
 * Validate the answer-related judge extras (`acceptableAnswers`, `gradingNotes`) shared
 * by the save path and the settle path. Returns a Claude-readable error or null.
 */
function validateFreeformAnswerExtras(
  acceptableAnswers: string[] | undefined,
  gradingNotes: string | undefined,
): string | null {
  if (acceptableAnswers !== undefined) {
    for (let i = 0; i < acceptableAnswers.length; i++) {
      const trimmed = acceptableAnswers[i].trim();
      if (trimmed.length < 1 || trimmed.length > 200) {
        return `acceptableAnswers[${i}] must be 1-200 characters after trim (got ${trimmed.length}).`;
      }
    }
  }
  if (gradingNotes !== undefined && gradingNotes.length > 500) {
    return `"gradingNotes" must be at most 500 characters (got ${gradingNotes.length}).`;
  }
  return null;
}

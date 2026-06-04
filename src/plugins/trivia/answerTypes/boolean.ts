import { z } from "zod";
import type { ClackSdk } from "../../sdk.js";
import type { SlackBlocks } from "../../../slack/blocks.js";
import { t } from "../i18n/t.js";
import type { JsonValue } from "../core/configTypes.js";
import type { SubmittedAnswer, TriviaQuestion, TriviaUser } from "../core/types.js";
import type { Voter, VoterBuckets } from "../tools/reveal/types.js";
import { buildExcludeSet, isScoredAnswer, loadQuestionCheaterIds } from "./cheaterFilter.js";
import { buildNoAnswerBucket, buildReactionsList, buildReactorIndex } from "./reactorBuckets.js";
import { fetchQuestionReactions, parseMessageCoordinates } from "./revealMessage.js";
import { makeRevealOutcome } from "./revealOutcome.js";
import { installClickableVoteHandler } from "./clickHandlerInstaller.js";
import type {
  ClickableAnswerHandler,
  GetSavedQuestionOutcome,
  InteractionRegistrationDeps,
  ProcessRevealDeps,
  ProcessRevealOutcome,
  ProjectRevealDeps,
  ResolvedClick,
  SaveQuestionArgs,
  SaveValidationContext,
  SuggestionRollDeps,
  TriviaQuestionBase,
} from "./types.js";

/**
 * Per-format Zod field-fragment for `save_question`. Spread into the tool's
 * input schema at module load by the registry. Adding a new format means
 * writing a new fragment; no edits to the shared schema or sibling handlers.
 */
export const BOOLEAN_SAVE_FIELDS = {
  isTrue: z
    .boolean()
    .optional()
    .describe(
      'REQUIRED for boolean questions. MUST NOT be set when answersFormat is "choice" or "freeform".',
    ),
} as const;

/**
 * Value pattern for boolean votes: action_ids must end with `:true` or
 * `:false`. Scoped narrowly so a future format's value space (e.g. choice's
 * `:[0-9]+`) doesn't collide.
 */
const BOOLEAN_VOTE_PATTERN = /^vote:[^:]+:(true|false)$/;

export const booleanAnswerHandler: ClickableAnswerHandler = {
  actionAffordanceDescription:
    'answersFormat "boolean" → two vote buttons (👍 TRUE / 👎 FALSE) appended below the question card.',
  revealAnswerShapeDescription: '`{ type: "boolean", isTrue }` for boolean questions.',
  historyResultShapeDescription:
    'Boolean: `{ answersFormat: "boolean", questionType, isTrue, cheaterUserIds, responses: Array<{ userId, displayName, answer, correct? }> }`',

  appendActionsBlock(
    blocks: SlackBlocks,
    actionId: (key: string) => string,
    question: TriviaQuestion,
  ): SlackBlocks {
    return [
      ...blocks,
      {
        type: "actions",
        block_id: `vote-actions:${question.id}`,
        elements: [
          {
            type: "button",
            action_id: actionId(`vote:${question.id}:true`),
            text: { type: "plain_text", text: t("button.true"), emoji: true },
            style: "primary",
          },
          {
            type: "button",
            action_id: actionId(`vote:${question.id}:false`),
            text: { type: "plain_text", text: t("button.false"), emoji: true },
            style: "danger",
          },
        ],
      },
    ];
  },

  resolveClick(rawValue: string, question: TriviaQuestion): ResolvedClick | null {
    if (rawValue !== "true" && rawValue !== "false") return null;
    const answer = rawValue === "true";
    return {
      payload: { answer },
      correct: answer === (question.isTrue ?? false),
    };
  },

  toAnswerPatch(resolved: ResolvedClick): Partial<SubmittedAnswer> {
    if (!("answer" in resolved.payload)) {
      // Defensive: a stale ResolvedClick from a different format. The
      // installer guards by `resolveClick` returning null, so this is
      // unreachable in practice; we keep the patch minimal to avoid
      // corrupting the row.
      return { correct: resolved.correct };
    }
    return {
      answer: resolved.payload.answer,
      answerIndex: undefined,
      answerText: undefined,
      correct: resolved.correct,
    };
  },

  formatSubmittedAnswer(_question: TriviaQuestion, row: SubmittedAnswer): string {
    if (typeof row.answer !== "boolean") return "";
    return row.answer ? t("button.true") : t("button.false");
  },

  rosterGroupKey(answer: SubmittedAnswer): string | null {
    if (typeof answer.answer !== "boolean") return null;
    return answer.answer ? "true" : "false";
  },

  rosterGroupLabel(group): string {
    return group.groupKey === "true" ? "👍" : "👎";
  },

  buildRevealAnswer(question: TriviaQuestion) {
    return { type: "boolean" as const, isTrue: question.isTrue ?? false };
  },

  formatCorrectAnswer(question: TriviaQuestion): string {
    return (question.isTrue ?? false) ? t("button.true") : t("button.false");
  },

  async processReveal(
    question: TriviaQuestion,
    deps: ProcessRevealDeps,
  ): Promise<ProcessRevealOutcome> {
    if (deps.isReprocessMode) {
      // Re-derive ONLY the verdict on each RETAINED answer row from the (possibly
      // corrected) `isTrue` key. The raw button click is the canonical record and
      // is never deleted — reprocess recomputes `correct`, nothing else.
      const rows = (await deps.scoped.loadAnswers()).filter((a) => a.questionId === question.id);
      for (const row of rows) {
        const correct = (row.answer ?? false) === (question.isTrue ?? false);
        await deps.scoped.updateAnswer(row.userId, question.id, { correct });
      }
    }
    await deps.scoped.updateQuestion(question.id, { processedAt: deps.now });
    const outcome = await booleanAnswerHandler.projectReveal(question, deps);
    if (outcome.ok && deps.isReprocessMode) {
      return { ...outcome, entry: { ...outcome.entry, wasReprocessed: true } };
    }
    return outcome;
  },

  async projectReveal(
    question: TriviaQuestion,
    deps: ProjectRevealDeps,
  ): Promise<ProcessRevealOutcome> {
    const coords = parseMessageCoordinates(question);
    if ("error" in coords) return { ok: false, error: coords.error };

    const reactions = await fetchQuestionReactions(coords.channel, coords.ts, deps);
    if (!Array.isArray(reactions)) return { ok: false, error: reactions.error };

    const cheaterIds = await loadQuestionCheaterIds(deps.scoped, question.id);
    const allAnswers = await deps.scoped.loadAnswers();
    const questionAnswers = allAnswers.filter((a) => a.questionId === question.id);

    const voters = assembleBooleanVoters(question, questionAnswers, reactions, cheaterIds, deps);

    return makeRevealOutcome(
      question,
      booleanAnswerHandler.buildRevealAnswer(question),
      voters,
      false,
    );
  },

  getSavedQuestion(
    base: TriviaQuestionBase,
    args: SaveQuestionArgs,
    _ctx: SaveValidationContext,
  ): GetSavedQuestionOutcome {
    if (args.isTrue === undefined) {
      return { ok: false, error: 'Boolean questions require "isTrue".' };
    }
    return { ok: true, question: { ...base, isTrue: args.isTrue } };
  },

  rollGenerationSuggestions(_deps: SuggestionRollDeps): Record<string, JsonValue> {
    return { suggestedAnswer: Math.random() < 0.5 };
  },

  buildHistoryResult(
    question: TriviaQuestion,
    matching: readonly SubmittedAnswer[],
    users: ReadonlyMap<string, TriviaUser>,
  ): JsonValue {
    const responses = matching.map((a) => {
      const entry: { userId: string; displayName: string; answer: boolean; correct?: boolean } = {
        userId: a.userId,
        displayName: users.get(a.userId)?.displayName ?? a.userId,
        answer: a.answer ?? false,
      };
      if (a.correct !== undefined) entry.correct = a.correct;
      return entry;
    });
    return {
      answersFormat: "boolean",
      isTrue: question.isTrue ?? false,
      responses,
    };
  },

  buildSearchResult(_question: TriviaQuestion): Record<string, JsonValue> {
    return {};
  },

  registerInteractions(sdk: ClackSdk, deps: InteractionRegistrationDeps): void {
    installClickableVoteHandler(sdk, booleanAnswerHandler, deps, BOOLEAN_VOTE_PATTERN);
  },
};

/**
 * Assemble the discriminated `VoterBuckets` variant for a boolean reveal.
 * Boolean voters never carry per-row metadata beyond user info, so the
 * Voter shape is plain `{ userId, displayName }` regardless of mode.
 */
function assembleBooleanVoters(
  question: TriviaQuestion,
  questionAnswers: SubmittedAnswer[],
  rawReactions: Parameters<typeof buildReactorIndex>[0],
  cheaterIds: ReadonlySet<string>,
  deps: ProjectRevealDeps,
): VoterBuckets {
  const mode = question.revealResponses ?? "yes";
  const excludeIds = buildExcludeSet(deps.botUserId, cheaterIds);
  const reactorIndex = buildReactorIndex(rawReactions, excludeIds);
  const reactions = buildReactionsList(reactorIndex, deps.users);

  if (mode === "no") return { revealResponses: "no", reactions };

  const correct: Voter[] = [];
  const incorrect: Voter[] = [];
  const answeredUserIds = new Set<string>();
  for (const a of questionAnswers) {
    if (!isScoredAnswer(a, cheaterIds, deps.botUserId)) continue;
    answeredUserIds.add(a.userId);
    const voter: Voter = {
      userId: a.userId,
      displayName: deps.users.get(a.userId)?.displayName ?? a.userId,
    };
    if (a.correct === true) correct.push(voter);
    else incorrect.push(voter);
  }
  const noAnswer = buildNoAnswerBucket(reactorIndex, answeredUserIds, deps.users);
  if (mode === "just-winners") {
    return {
      revealResponses: "just-winners",
      correct,
      incorrectCount: incorrect.length,
      noAnswerCount: noAnswer.length,
      reactions,
    };
  }
  if (mode === "yes") {
    return { revealResponses: "yes", correct, incorrect, noAnswer, reactions };
  }
  return { revealResponses: "just-correctness", correct, incorrect, noAnswer, reactions };
}

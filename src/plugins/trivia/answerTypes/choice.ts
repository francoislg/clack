import { z } from "zod";
import type { ClackSdk } from "../../sdk.js";
import type { SlackBlocks } from "../../../slack/blocks.js";
import type { JsonValue } from "../core/configTypes.js";
import { DEFAULT_TRIVIA_CHOICES } from "../core/configTypes.js";
import { getActiveChoiceBounds } from "../domain/questionTypes.js";
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
  ResolvedClick,
  SaveQuestionArgs,
  SaveValidationContext,
  SuggestionRollDeps,
  TriviaQuestionBase,
} from "./types.js";

/**
 * Per-format Zod field-fragment for `save_question`. Spread into the tool's
 * input schema at module load by the registry.
 */
export const CHOICE_SAVE_FIELDS = {
  choices: z
    .array(z.string())
    .optional()
    .describe(
      'REQUIRED for choice questions (length within active [min, max]). MUST NOT be set when answersFormat is "boolean" or "freeform".',
    ),
  correctIndex: z
    .number()
    .int()
    .optional()
    .describe(
      'REQUIRED for choice questions (0-based, in [0, choices.length)). MUST NOT be set when answersFormat is "boolean" or "freeform".',
    ),
} as const;

/** Numbered-emoji prefixes for choice buttons + roster labels, in index order (0..3). */
const CHOICE_NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"] as const;

/**
 * Value pattern for choice votes: action_ids must end with `:<integer>`.
 * Scoped narrowly so it doesn't collide with boolean's `:true|:false` value
 * space.
 */
const CHOICE_VOTE_PATTERN = /^vote:[^:]+:[0-9]+$/;

/** Inclusive uniform integer in `[min, max]`. */
function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const choiceAnswerHandler: ClickableAnswerHandler = {
  actionAffordanceDescription:
    'answersFormat "choice" → one vote button per choice option (1️⃣ 2️⃣ 3️⃣ 4️⃣ prefixes) appended below the question card.',
  revealAnswerShapeDescription: '`{ type: "choice", choices, correctIndex }` for choice questions.',
  historyResultShapeDescription:
    'Choice: `{ answersFormat: "choice", questionType, choices, correctIndex, cheaterUserIds, responses: Array<{ userId, displayName, answerIndex, correct? }> }`',

  appendActionsBlock(
    blocks: SlackBlocks,
    actionId: (key: string) => string,
    question: TriviaQuestion,
  ): SlackBlocks {
    const choices = question.choices ?? [];
    return [
      ...blocks,
      {
        type: "actions",
        block_id: `vote-actions:${question.id}`,
        elements: choices.map((choice, i) => ({
          type: "button",
          action_id: actionId(`vote:${question.id}:${i}`),
          text: {
            type: "plain_text",
            text: `${CHOICE_NUMBER_EMOJI[i] ?? ""} ${choice}`,
            emoji: true,
          },
        })),
      },
    ];
  },

  resolveClick(rawValue: string, question: TriviaQuestion): ResolvedClick | null {
    const answerIndex = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(answerIndex)) return null;
    const choicesLength = question.choices?.length ?? 0;
    if (answerIndex < 0 || answerIndex >= choicesLength) return null;
    return {
      payload: { answerIndex },
      correct: answerIndex === (question.correctIndex ?? -1),
    };
  },

  toAnswerPatch(resolved: ResolvedClick): Partial<SubmittedAnswer> {
    if (!("answerIndex" in resolved.payload)) {
      return { correct: resolved.correct };
    }
    return {
      answerIndex: resolved.payload.answerIndex,
      answer: undefined,
      answerText: undefined,
      correct: resolved.correct,
    };
  },

  rosterGroupKey(answer: SubmittedAnswer): string | null {
    if (typeof answer.answerIndex !== "number") return null;
    return String(answer.answerIndex);
  },

  rosterGroupLabel(group): string {
    const idx = Number.parseInt(group.groupKey, 10);
    return CHOICE_NUMBER_EMOJI[idx] ?? `#${group.groupKey}`;
  },

  buildRevealAnswer(question: TriviaQuestion) {
    return {
      type: "choice" as const,
      choices: question.choices ?? [],
      correctIndex: question.correctIndex ?? -1,
    };
  },

  formatCorrectAnswer(question: TriviaQuestion): string {
    const choices = question.choices ?? [];
    const idx = question.correctIndex ?? -1;
    return choices[idx] ?? "";
  },

  formatSubmittedAnswer(question: TriviaQuestion, row: SubmittedAnswer): string {
    const choices = question.choices ?? [];
    if (typeof row.answerIndex !== "number") return "";
    return choices[row.answerIndex] ?? "";
  },

  async processReveal(
    question: TriviaQuestion,
    deps: ProcessRevealDeps,
  ): Promise<ProcessRevealOutcome> {
    if ((question.correctIndex ?? -1) < 0) {
      return { ok: false, error: "choice question is missing correctIndex" };
    }

    const coords = parseMessageCoordinates(question);
    if ("error" in coords) return { ok: false, error: coords.error };

    const reactions = await fetchQuestionReactions(coords.channel, coords.ts, deps);
    if (!Array.isArray(reactions)) return { ok: false, error: reactions.error };

    if (deps.isReprocessMode) {
      await deps.scoped.deleteAnswersForQuestion(question.id);
    }
    const cheaterIds = await loadQuestionCheaterIds(deps.scoped, question.id);
    const allAnswers = await deps.scoped.loadAnswers();
    const questionAnswers = allAnswers.filter((a) => a.questionId === question.id);

    const voters = assembleChoiceVoters(question, questionAnswers, reactions, cheaterIds, deps);

    await deps.scoped.updateQuestion(question.id, { processedAt: deps.now });
    return makeRevealOutcome(
      question,
      choiceAnswerHandler.buildRevealAnswer(question),
      voters,
      deps.isReprocessMode,
    );
  },

  getSavedQuestion(
    base: TriviaQuestionBase,
    args: SaveQuestionArgs,
    ctx: SaveValidationContext,
  ): GetSavedQuestionOutcome {
    if (args.choices === undefined) {
      return { ok: false, error: 'Choice questions require "choices".' };
    }
    if (args.correctIndex === undefined) {
      return { ok: false, error: 'Choice questions require "correctIndex".' };
    }
    const bounds = ctx.config?.choices ?? DEFAULT_TRIVIA_CHOICES;
    if (args.choices.length < bounds.min || args.choices.length > bounds.max) {
      return {
        ok: false,
        error: `Choice question must have between ${bounds.min} and ${bounds.max} options (got ${args.choices.length}).`,
      };
    }
    if (args.correctIndex < 0 || args.correctIndex >= args.choices.length) {
      return {
        ok: false,
        error: `correctIndex (${args.correctIndex}) must be in [0, ${args.choices.length}).`,
      };
    }
    for (let i = 0; i < args.choices.length; i++) {
      const trimmed = args.choices[i].trim();
      if (trimmed.length < 1 || trimmed.length > 40) {
        return {
          ok: false,
          error: `Choice at index ${i} must be 1-40 characters after trim (got ${trimmed.length}).`,
        };
      }
    }
    const normalized = args.choices.map((c) => c.trim().toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      return { ok: false, error: "Choices must be unique (after trimming and case-folding)." };
    }
    return {
      ok: true,
      question: {
        ...base,
        choices: args.choices,
        correctIndex: args.correctIndex,
      },
    };
  },

  rollGenerationSuggestions(deps: SuggestionRollDeps): Record<string, JsonValue> {
    const bounds = getActiveChoiceBounds(deps.cascadeCtx.config);
    const suggestedChoiceCount = randomIntInclusive(bounds.min, bounds.max);
    const suggestedCorrectIndex = randomIntInclusive(0, suggestedChoiceCount - 1);
    return { suggestedChoiceCount, suggestedCorrectIndex };
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
        answerIndex: number;
        correct?: boolean;
      } = {
        userId: a.userId,
        displayName: users.get(a.userId)?.displayName ?? a.userId,
        answerIndex: a.answerIndex ?? -1,
      };
      if (a.correct !== undefined) entry.correct = a.correct;
      return entry;
    });
    return {
      answersFormat: "choice",
      choices: question.choices ?? [],
      correctIndex: question.correctIndex ?? -1,
      responses,
    };
  },

  buildSearchResult(question: TriviaQuestion): Record<string, JsonValue> {
    return question.choices !== undefined ? { choices: question.choices } : {};
  },

  registerInteractions(sdk: ClackSdk, deps: InteractionRegistrationDeps): void {
    installClickableVoteHandler(sdk, choiceAnswerHandler, deps, CHOICE_VOTE_PATTERN);
  },
};

/**
 * Assemble the discriminated `VoterBuckets` variant for a choice reveal.
 * Choice voters carry no per-row metadata beyond user info — the Voter
 * shape is plain `{ userId, displayName }` regardless of mode.
 */
function assembleChoiceVoters(
  question: TriviaQuestion,
  questionAnswers: SubmittedAnswer[],
  rawReactions: Parameters<typeof buildReactorIndex>[0],
  cheaterIds: ReadonlySet<string>,
  deps: ProcessRevealDeps,
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

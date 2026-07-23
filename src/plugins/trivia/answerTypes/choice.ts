import { z } from "zod";
import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import type { SlackBlocks } from "../../../plugins-sdk/sdk.js";
import type { JsonValue } from "../core/configTypes.js";
import { resolveCascade } from "../domain/resolveCascade.js";
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
  SettleOutcomeInput,
  SettleOutcomeResult,
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
  choiceEmojis: z
    .array(z.string())
    .optional()
    .describe(
      'OPTIONAL, choice questions only, and ONLY when get_ideas returned `suggestedChoiceEmojiStyle: "themed"`: one Unicode emoji per option (parallel to `choices`, same length, unique, actual emoji characters — never :shortcodes:). Each emoji prefixes its option\'s vote button and labels its group in the live answer roster. Omit to fall back to numbered prefixes.',
    ),
} as const;

/** Numbered-emoji prefixes for choice buttons + roster labels, in index order (0..3). */
const CHOICE_NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"] as const;

/**
 * The emoji prefix for option `idx`: the stamped themed emoji when the record
 * carries one, else the numbered fallback. Single source for buttons + roster
 * labels so the two surfaces can never disagree.
 */
function choicePrefixEmoji(question: TriviaQuestion, idx: number): string | undefined {
  return question.choiceEmojis?.[idx] ?? CHOICE_NUMBER_EMOJI[idx];
}

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

/**
 * Validate the option list shared by both the answered (`getSavedQuestion`) and the
 * deferred-prediction (`getDeferredSavedQuestion`) save paths: count within bounds,
 * each option 1–40 chars after trim, and unique after trim+case-fold. Returns the
 * Claude-readable error string, or null when valid. The `correctIndex` check stays
 * out of here — it only applies to the answered path.
 */
function validateChoiceList(
  choices: string[],
  bounds: { min: number; max: number },
): string | null {
  if (choices.length < bounds.min || choices.length > bounds.max) {
    return `Choice question must have between ${bounds.min} and ${bounds.max} options (got ${choices.length}).`;
  }
  for (let i = 0; i < choices.length; i++) {
    const trimmed = choices[i].trim();
    if (trimmed.length < 1 || trimmed.length > 40) {
      return `Choice at index ${i} must be 1-40 characters after trim (got ${trimmed.length}).`;
    }
  }
  const normalized = choices.map((c) => c.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    return "Choices must be unique (after trimming and case-folding).";
  }
  return null;
}

/**
 * Validate a themed `choiceEmojis` list against its `choices`: same length, each
 * entry a short non-empty string containing at least one non-ASCII character (a
 * Unicode emoji — `:shortcode:` text fails this), unique after trim. Returns the
 * Claude-readable error string, or null when valid.
 */
function validateChoiceEmojiList(choiceEmojis: string[], choicesLength: number): string | null {
  if (choiceEmojis.length !== choicesLength) {
    return `choiceEmojis must have exactly one emoji per option (got ${choiceEmojis.length} for ${choicesLength} choices).`;
  }
  for (let i = 0; i < choiceEmojis.length; i++) {
    const trimmed = choiceEmojis[i].trim();
    if (trimmed.length < 1 || trimmed.length > 16) {
      return `choiceEmojis[${i}] must be a single emoji (1-16 chars after trim, got ${trimmed.length}).`;
    }
    if (!/[^\x20-\x7E]/.test(trimmed)) {
      return `choiceEmojis[${i}] ("${trimmed}") must be a Unicode emoji character, not text or a :shortcode:.`;
    }
  }
  const normalized = choiceEmojis.map((e) => e.trim());
  if (new Set(normalized).size !== normalized.length) {
    return "choiceEmojis must be unique — two options sharing an emoji makes the roster ambiguous.";
  }
  return null;
}

export const choiceAnswerHandler: ClickableAnswerHandler = {
  actionAffordanceDescription:
    'answersFormat "choice" → one vote button per choice option appended below the question card, prefixed by the record\'s stamped `choiceEmojis` when present (themed choiceEmojiStyle), else by 1️⃣ 2️⃣ 3️⃣ 4️⃣.',
  revealAnswerShapeDescription: '`{ type: "choice", choices, correctIndex }` for choice questions.',
  reprocessReStampAxes: ["revealResponses"],
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
            text: `${choicePrefixEmoji(question, i) ?? ""} ${choice}`,
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
      // No key yet (deferred prediction) → pending verdict; the reveal derives it
      // once `settle_question` stamps `correctIndex`.
      correct:
        question.correctIndex === undefined ? undefined : answerIndex === question.correctIndex,
    };
  },

  hasAnswerKey(question: TriviaQuestion): boolean {
    return question.correctIndex !== undefined;
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

  rosterGroupLabel(group, question): string {
    const idx = Number.parseInt(group.groupKey, 10);
    return choicePrefixEmoji(question, idx) ?? `#${group.groupKey}`;
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

    // Derive the verdict on RETAINED answer rows from the `correctIndex` key. Reprocess
    // re-derives every row (after a key/config correction); the default reveal only
    // fills rows still PENDING (`correct: undefined`) — clicks placed on a deferred
    // prediction before it was settled. The raw button click is canonical and never
    // deleted.
    {
      const rows = await deps.strategy.getFinalAnswers(question.id);
      for (const row of rows) {
        // A hand-overridden row (originalVerdict set) is admin-authoritative: keep
        // its stored verdict, don't recompute it from the key.
        if (row.originalVerdict !== undefined) continue;
        if (!deps.isReprocessMode && row.correct !== undefined) continue;
        const correct = row.answerIndex === question.correctIndex;
        await deps.strategy.applyVerdict(row.userId, question.id, { correct });
      }
    }
    await deps.scoped.updateQuestion(question.id, { processedAt: deps.now });
    const outcome = await choiceAnswerHandler.projectReveal(question, deps);
    if (outcome.ok && deps.isReprocessMode) {
      return { ...outcome, entry: { ...outcome.entry, wasReprocessed: true } };
    }
    return outcome;
  },

  async projectReveal(
    question: TriviaQuestion,
    deps: ProjectRevealDeps,
  ): Promise<ProcessRevealOutcome> {
    if ((question.correctIndex ?? -1) < 0) {
      return { ok: false, error: "choice question is missing correctIndex" };
    }

    const coords = parseMessageCoordinates(question);
    if ("error" in coords) return { ok: false, error: coords.error };

    const reactions = await fetchQuestionReactions(coords.channel, coords.ts, deps);
    if (!Array.isArray(reactions)) return { ok: false, error: reactions.error };

    const cheaterIds = await loadQuestionCheaterIds(deps.scoped, question.id);
    const questionAnswers = await deps.strategy.getFinalAnswers(question.id);

    const voters = assembleChoiceVoters(question, questionAnswers, reactions, cheaterIds, deps);

    return makeRevealOutcome(
      question,
      choiceAnswerHandler.buildRevealAnswer(question),
      voters,
      false,
    );
  },

  composeStatic(
    base: TriviaQuestionBase,
    args: SaveQuestionArgs,
    ctx: SaveValidationContext,
  ): GetSavedQuestionOutcome {
    if (args.choices === undefined) {
      return { ok: false, error: 'Choice questions require "choices".' };
    }
    const listError = validateChoiceList(args.choices, ctx.resolvedChoiceBounds);
    if (listError !== null) {
      return { ok: false, error: listError };
    }
    if (args.choiceEmojis !== undefined) {
      if (ctx.resolvedChoiceEmojiStyle !== "themed") {
        return {
          ok: false,
          error:
            'choiceEmojis is only permitted when the resolved choiceEmojiStyle is "themed" (it is "numbers" for this slot/season/game/workspace). Omit choiceEmojis — buttons get numbered prefixes.',
        };
      }
      const emojiError = validateChoiceEmojiList(args.choiceEmojis, args.choices.length);
      if (emojiError !== null) {
        return { ok: false, error: emojiError };
      }
    }
    return {
      ok: true,
      question: {
        ...base,
        choices: args.choices,
        ...(args.choiceEmojis !== undefined
          ? { choiceEmojis: args.choiceEmojis.map((e) => e.trim()) }
          : {}),
      },
    };
  },

  settleInputFromSaveArgs(args: SaveQuestionArgs): SettleOutcomeInput {
    return { outcome: args.correctIndex };
  },

  settleOutcome(question: TriviaQuestion, input: SettleOutcomeInput): SettleOutcomeResult {
    const { outcome } = input;
    if (outcome === undefined) {
      return { ok: false, error: 'Choice questions require "correctIndex".' };
    }
    const choices = question.choices ?? [];
    if (choices.length === 0) {
      return { ok: false, error: "choice question is missing its choices" };
    }
    let index: number;
    if (typeof outcome === "number") {
      index = outcome;
    } else if (typeof outcome === "string") {
      const target = outcome.trim().toLowerCase();
      index = choices.findIndex((c) => c.trim().toLowerCase() === target);
      if (index < 0) {
        return { ok: false, error: `Outcome "${outcome}" does not match any of the choices.` };
      }
    } else {
      return {
        ok: false,
        error: "Choice answer must be the winning option's 0-based index or exact text.",
      };
    }
    if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
      return { ok: false, error: `correctIndex (${index}) must be in [0, ${choices.length}).` };
    }
    return { ok: true, keyPatch: { correctIndex: index }, resolvedOutcome: choices[index] };
  },

  rollGenerationSuggestions(deps: SuggestionRollDeps): Record<string, JsonValue> {
    const bounds = resolveCascade("choices", deps.cascadeCtx).value;
    const suggestedChoiceCount = randomIntInclusive(bounds.min, bounds.max);
    const suggestedCorrectIndex = randomIntInclusive(0, suggestedChoiceCount - 1);
    const suggestedChoiceEmojiStyle = resolveCascade("choiceEmojiStyle", deps.cascadeCtx).value;
    return {
      suggestedChoiceCount,
      suggestedCorrectIndex,
      suggestedChoiceEmojiStyle,
      ...(suggestedChoiceEmojiStyle === "themed"
        ? {
            choiceEmojiGuidance:
              "Pick ONE Unicode emoji per option (actual emoji characters, never :shortcodes:), each visually evoking ITS OWN option's subject — all options get an equally fitting emoji, so the set must not hint at which is correct. Emojis must be unique within the question. SPOILER TEST — the emoji must identify the option, never answer the question: ask what property the question is testing (which one is a swimmer / a mountain / a mammal / blue), and if any option's emoji would encode THAT property, the set leaks even though every option has its own emoji. Only use themed emojis when each evokes the option as a standalone subject, ORTHOGONAL to the discriminating axis; otherwise OMIT choiceEmojis and fall back to numbered prefixes. Pass them to save_question as `choiceEmojis` (parallel to `choices`, same order). If no fitting set exists, OMIT choiceEmojis — buttons fall back to numbered prefixes.",
          }
        : {}),
    };
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

  keywordHaystack(question: TriviaQuestion): string[] {
    return [...(question.choices ?? [])];
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

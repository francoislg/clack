/**
 * Pure validator for the `format` field on both season entries and game entries.
 * Lives in `configParsers/` (next to `axes.ts`) so the workspace-tier parser
 * (`parseTriviaGames`) can use it without depending on `domain/`. The slot-by-slot
 * walker delegates to the same axis validators that `parseTriviaAxisBag` uses.
 */

import { z } from "zod";
import type { RevealResponsesMode, SeasonFormat, SeasonFormatSlot } from "../configTypes.js";
import {
  REVEAL_RESPONSES_VALUES,
  answersFormatZod,
  contextsZod,
  difficultyZod,
  freeformAnswerShapeZod,
  isRevealResponsesMode,
  questionTypeZod,
  promptMediumZod,
  triviaChoiceEmojiStyleZod,
  triviaChoicesZod,
  triviaPointsZod,
  triviaDifficultyRatioZod,
  triviaHintZod,
  triviaJudgeLeniencyZod,
  validateAnswersFormatMap,
  validateChoiceEmojiStyle,
  validateContextsList,
  validateFreeformAnswerShapeMap,
  validateHintConfig,
  validateJudgeLeniency,
  validateQuestionTypeMap,
  validatePromptMediumMap,
  validateTriviaChoicesConfig,
  validateTriviaPoints,
  validateTriviaDifficultyMap,
  validateTriviaDifficultyRatioMap,
} from "./axes.js";
import { type Result } from "../../../../plugins-sdk/sdk.js";

export function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of values) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Validate the per-tier `theme` field (carried by `SeasonEntry` and `TriviaGame`).
 * Trims, rejects empty / whitespace-only. The caller is responsible for
 * forwarding the result to storage. Used by `upsert_season` and `upsert_game`.
 */
export function normalizeTheme(raw: string): Result<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "theme must be non-empty (pass null to clear)." };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate the per-tier `instructions` field (replace-cascade axis defined in
 * the `trivia-prompt-instructions` capability). Trims, rejects empty / whitespace-only.
 */
export function normalizeInstructions(raw: string): Result<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "instructions must be non-empty (pass null to clear)." };
  }
  return { ok: true, value: trimmed };
}

/** The cumulative-cascade free-text fields, which share one normalizer and zod schema. */
export type CumulativeInstructionsField = "additionalInstructions" | "judgeInstructions";

/**
 * Validate a per-tier cumulative-cascade free-text field (`additionalInstructions`,
 * `judgeInstructions`). Trims, rejects empty / whitespace-only. `field` names the
 * field in the error message.
 */
export function normalizeAdditionalInstructions(
  raw: string,
  field: CumulativeInstructionsField = "additionalInstructions",
): Result<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: `${field} must be non-empty (pass null to clear).` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Parse a cumulative-cascade free-text field read from disk/config as `unknown`:
 * must be a string that is non-empty after trim. Errors are bare ("must be a string",
 * "must be non-empty after trim") so each caller prefixes its own field path.
 */
export function parseCumulativeInstructions(raw: unknown): Result<string> {
  if (typeof raw !== "string") return { ok: false, error: "must be a string" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "must be non-empty after trim" };
  return { ok: true, value: trimmed };
}

/**
 * Validate the per-tier `categories` field (carried by `SeasonEntry` and
 * `TriviaGame`). Trims, drops empty strings, dedupes preserving order, rejects
 * empty result. The caller forwards the deduped list to storage. Used by
 * `upsert_season` and `upsert_game`.
 */
export function normalizeCategories(raw: string[]): Result<string[]> {
  const trimmed = raw.map((c) => c.trim()).filter((c) => c.length > 0);
  const deduped = dedupePreservingOrder(trimmed);
  if (deduped.length === 0) {
    return { ok: false, error: "categories must contain at least one non-empty string." };
  }
  return { ok: true, value: deduped };
}

/**
 * A slot's axis bag as it arrives from parsed JSON — every field is `unknown`
 * (narrowed per-field inside `collectSlotFieldIssues`). Typed loosely on purpose:
 * a format slot, a season `slotOverrides` entry, and a phase slice all reach the
 * same validator from different upstream shapes (typed zod output, plain
 * `JsonObject`), and each field is validated by a checker that already accepts
 * `unknown`.
 */
const CUMULATIVE_INSTRUCTIONS_FIELDS: readonly CumulativeInstructionsField[] = [
  "additionalInstructions",
  "judgeInstructions",
];

export interface RawSlot {
  label?: unknown;
  categories?: unknown;
  answersFormat?: unknown;
  questionType?: unknown;
  promptMedium?: unknown;
  freeformAnswerShape?: unknown;
  contexts?: unknown;
  difficulty?: unknown;
  difficultyRatio?: unknown;
  liveAnswersVisible?: unknown;
  revealResponses?: unknown;
  instructions?: unknown;
  additionalInstructions?: unknown;
  judgeInstructions?: unknown;
  hint?: unknown;
  judgeLeniency?: unknown;
  choices?: unknown;
  choiceEmojiStyle?: unknown;
  points?: unknown;
}

interface RawFormat {
  questions?: RawSlot[];
  flexible?: unknown;
}

/**
 * Validate a `format` field. The optional `fieldLabel` is prepended to nested
 * error messages — callers pass `"format"` (the upsert_season tool) for the
 * default label, or a richer prefix like `"trivia.games[2].format"` (the
 * workspace-tier parser).
 */
export function validateFormat(
  raw: RawFormat | null | undefined,
  fieldLabel: string = "format",
): Result<SeasonFormat> {
  if (raw === null || raw === undefined) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const questions = raw.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, error: `'${fieldLabel}.questions' must be a non-empty array` };
  }
  const normalized: SeasonFormatSlot[] = [];
  for (let i = 0; i < questions.length; i++) {
    const r = validateSlotConfig(questions[i], `${fieldLabel}.questions[${i}]`);
    if (!r.ok) return r;
    normalized.push(r.value);
  }
  if (raw.flexible !== undefined && typeof raw.flexible !== "boolean") {
    return { ok: false, error: `'${fieldLabel}.flexible' must be a boolean` };
  }
  return {
    ok: true,
    value: {
      questions: normalized,
      ...(raw.flexible !== undefined ? { flexible: raw.flexible } : {}),
    },
  };
}

/** A per-field validation failure inside a slot's axis bag. `field` is the bare axis name. */
export interface SlotFieldIssue {
  field: string;
  error: string;
}

/**
 * Validate a slot's axis bag field-by-field, COLLECTING every failure instead of
 * stopping at the first. Returns the fields that validated (normalized) plus a
 * labeled issue per field that failed. `validateSlotConfig` wraps this to fail
 * fast (format slots / slotOverrides); the graceful phase reader uses the
 * per-field issues to drop only the offending field while keeping the rest of the
 * slice. Same normalization/validation for every caller — a single source of
 * truth for slot semantics.
 */
export function collectSlotFieldIssues(
  slot: RawSlot,
  slotLabel: string,
): { value: SeasonFormatSlot; issues: SlotFieldIssue[] } {
  const out: SeasonFormatSlot = {};
  const issues: SlotFieldIssue[] = [];
  if (typeof slot.label === "string") {
    const trimmed = slot.label.trim();
    if (trimmed.length === 0) {
      issues.push({ field: "label", error: `'${slotLabel}.label' must be non-empty after trim` });
    } else {
      out.label = trimmed;
    }
  }
  if (slot.categories !== undefined) {
    if (!Array.isArray(slot.categories) || slot.categories.length === 0) {
      issues.push({
        field: "categories",
        error: `'${slotLabel}.categories' must be a non-empty array when provided`,
      });
    } else {
      const deduped = dedupePreservingOrder(
        slot.categories.filter((c): c is string => typeof c === "string" && c.length > 0),
      );
      if (deduped.length === 0) {
        issues.push({
          field: "categories",
          error: `'${slotLabel}.categories' must contain at least one non-empty string`,
        });
      } else {
        out.categories = deduped;
      }
    }
  }
  if (slot.answersFormat !== undefined && slot.answersFormat !== null) {
    const validated = validateAnswersFormatMap(slot.answersFormat, `${slotLabel}.answersFormat`);
    if (!validated.ok) issues.push({ field: "answersFormat", error: validated.error });
    else out.answersFormat = validated.value;
  }
  if (slot.questionType !== undefined && slot.questionType !== null) {
    const validated = validateQuestionTypeMap(slot.questionType, `${slotLabel}.questionType`);
    if (!validated.ok) issues.push({ field: "questionType", error: validated.error });
    else out.questionType = validated.value;
  }
  if (slot.promptMedium !== undefined && slot.promptMedium !== null) {
    const validated = validatePromptMediumMap(slot.promptMedium, `${slotLabel}.promptMedium`);
    if (!validated.ok) issues.push({ field: "promptMedium", error: validated.error });
    else out.promptMedium = validated.value;
  }
  if (slot.freeformAnswerShape !== undefined && slot.freeformAnswerShape !== null) {
    const validated = validateFreeformAnswerShapeMap(
      slot.freeformAnswerShape,
      `${slotLabel}.freeformAnswerShape`,
    );
    if (!validated.ok) issues.push({ field: "freeformAnswerShape", error: validated.error });
    else out.freeformAnswerShape = validated.value;
  }
  if (slot.contexts !== undefined && slot.contexts !== null) {
    const validated = validateContextsList(slot.contexts, `${slotLabel}.contexts`);
    if (!validated.ok) issues.push({ field: "contexts", error: validated.error });
    else out.contexts = validated.value;
  }
  if (slot.difficulty !== undefined && slot.difficulty !== null) {
    const validated = validateTriviaDifficultyMap(slot.difficulty, `${slotLabel}.difficulty`);
    if (!validated.ok) issues.push({ field: "difficulty", error: validated.error });
    else out.difficulty = validated.value;
  }
  if (slot.difficultyRatio !== undefined && slot.difficultyRatio !== null) {
    const validated = validateTriviaDifficultyRatioMap(
      slot.difficultyRatio,
      `${slotLabel}.difficultyRatio`,
    );
    if (!validated.ok) issues.push({ field: "difficultyRatio", error: validated.error });
    else out.difficultyRatio = validated.value;
  }
  if (slot.liveAnswersVisible !== undefined && slot.liveAnswersVisible !== null) {
    if (typeof slot.liveAnswersVisible !== "boolean") {
      issues.push({
        field: "liveAnswersVisible",
        error: `'${slotLabel}.liveAnswersVisible' must be a boolean`,
      });
    } else {
      out.liveAnswersVisible = slot.liveAnswersVisible;
    }
  }
  if (slot.revealResponses !== undefined && slot.revealResponses !== null) {
    if (isRevealResponsesMode(slot.revealResponses)) {
      out.revealResponses = slot.revealResponses;
    } else {
      issues.push({
        field: "revealResponses",
        error: `'${slotLabel}.revealResponses' must be one of "no", "just-winners", "just-correctness", "yes"`,
      });
    }
  }
  if (slot.instructions !== undefined && slot.instructions !== null) {
    if (typeof slot.instructions !== "string") {
      issues.push({ field: "instructions", error: `'${slotLabel}.instructions' must be a string` });
    } else {
      const trimmed = slot.instructions.trim();
      if (trimmed.length === 0) {
        issues.push({
          field: "instructions",
          error: `'${slotLabel}.instructions' must be non-empty after trim`,
        });
      } else {
        out.instructions = trimmed;
      }
    }
  }
  for (const field of CUMULATIVE_INSTRUCTIONS_FIELDS) {
    const raw = slot[field];
    if (raw === undefined || raw === null) continue;
    const parsed = parseCumulativeInstructions(raw);
    if (parsed.ok) out[field] = parsed.value;
    else issues.push({ field, error: `'${slotLabel}.${field}' ${parsed.error}` });
  }
  if (slot.hint !== undefined && slot.hint !== null) {
    const validated = validateHintConfig(slot.hint, `${slotLabel}.hint`);
    if (!validated.ok) issues.push({ field: "hint", error: validated.error });
    else out.hint = validated.value;
  }
  if (slot.judgeLeniency !== undefined && slot.judgeLeniency !== null) {
    const validated = validateJudgeLeniency(slot.judgeLeniency, `${slotLabel}.judgeLeniency`);
    if (!validated.ok) issues.push({ field: "judgeLeniency", error: validated.error });
    else out.judgeLeniency = validated.value;
  }
  if (slot.choices !== undefined && slot.choices !== null) {
    const validated = validateTriviaChoicesConfig(slot.choices, `${slotLabel}.choices`);
    if (!validated.ok) issues.push({ field: "choices", error: validated.error });
    else out.choices = validated.value;
  }
  if (slot.choiceEmojiStyle !== undefined && slot.choiceEmojiStyle !== null) {
    const validated = validateChoiceEmojiStyle(
      slot.choiceEmojiStyle,
      `${slotLabel}.choiceEmojiStyle`,
    );
    if (!validated.ok) issues.push({ field: "choiceEmojiStyle", error: validated.error });
    else out.choiceEmojiStyle = validated.value;
  }
  if (slot.points !== undefined && slot.points !== null) {
    const validated = validateTriviaPoints(slot.points, `${slotLabel}.points`);
    if (!validated.ok) issues.push({ field: "points", error: validated.error });
    else out.points = validated.value;
  }
  return { value: out, issues };
}

/**
 * Validate one slot's per-axis overrides (the shape shared by a format slot and a season
 * `slotOverrides` entry). Returns the normalized `SeasonFormatSlot` or the FIRST labeled
 * error. Fail-fast wrapper over `collectSlotFieldIssues`.
 */
export function validateSlotConfig(slot: RawSlot, slotLabel: string): Result<SeasonFormatSlot> {
  const { value, issues } = collectSlotFieldIssues(slot, slotLabel);
  if (issues.length > 0) return { ok: false, error: issues[0].error };
  return { ok: true, value };
}

/**
 * Validate a season `slotOverrides` map — each value is a per-slot axis bag validated
 * exactly like a format slot. The caller owns the map's shape (slot-index keys); this only
 * runs the per-slot semantics.
 */
export function validateSlotOverrides(
  raw: { [slotIndex: string]: RawSlot },
  fieldLabel: string = "slotOverrides",
): Result<Record<number, SeasonFormatSlot>> {
  const out: Record<number, SeasonFormatSlot> = {};
  for (const [key, slot] of Object.entries(raw)) {
    const r = validateSlotConfig(slot, `${fieldLabel}.${key}`);
    if (!r.ok) return r;
    out[Number(key)] = r.value;
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Shared zod schemas for the structural fields that the per-game tier carries
// in addition to the axis bag: `format`, `categories`, `theme`. Same role as
// the axis-bag zod schemas in `axes.ts` — thin shape-check, with semantic
// validation delegated to the pure validators (`validateFormat` above plus
// dedupe-and-trim for categories / trim-and-non-empty for theme, handled by
// the parser in `games.ts`).
// ---------------------------------------------------------------------------

/**
 * The full per-tier axis bag carried by a format slot / season `slotOverrides` entry.
 * Structural shape-check only — deep per-axis semantics live in `validateSlotConfig`.
 * Exported so `phases.ts` reuses the identical axis set (a phase is the temporal
 * twin of a slot) rather than rebuilding it.
 */
export const seasonFormatSlotZod = z.object({
  label: z.string().optional(),
  categories: z.array(z.string()).optional(),
  answersFormat: answersFormatZod.optional(),
  questionType: questionTypeZod.optional(),
  promptMedium: promptMediumZod.optional(),
  freeformAnswerShape: freeformAnswerShapeZod.optional(),
  contexts: contextsZod.optional(),
  difficulty: difficultyZod.optional(),
  difficultyRatio: triviaDifficultyRatioZod.optional(),
  liveAnswersVisible: z.boolean().optional(),
  revealResponses: z
    .enum(REVEAL_RESPONSES_VALUES as readonly [RevealResponsesMode, ...RevealResponsesMode[]])
    .optional(),
  instructions: z.string().optional(),
  additionalInstructions: z.string().optional(),
  judgeInstructions: z.string().optional(),
  hint: triviaHintZod.optional(),
  judgeLeniency: triviaJudgeLeniencyZod.optional(),
  choices: triviaChoicesZod.optional(),
  choiceEmojiStyle: triviaChoiceEmojiStyleZod.optional(),
  points: triviaPointsZod.optional(),
});

/**
 * Shared zod schema for the `format` field carried by both `SeasonEntry` and
 * `TriviaGame`. The shape is the same at both tiers — only the cascade order
 * differs. Used by `upsert_season` and `upsert_game`.
 */
export const seasonFormatZod = z.object({
  questions: z.array(seasonFormatSlotZod),
  flexible: z.boolean().optional(),
});

/** Shared zod schema for the per-tier `categories` field. */
export const triviaCategoriesZod = z.array(z.string());

/** Shared zod schema for the per-tier `theme` field. */
export const triviaThemeZod = z.string();

/** Shared zod schema for the per-tier `instructions` field (replace cascade). */
export const triviaInstructionsZod = z.string();

/**
 * Shared zod schema for a per-tier cumulative-cascade free-text field
 * (`additionalInstructions`, `judgeInstructions`).
 */
export const triviaAdditionalInstructionsZod = z.string();

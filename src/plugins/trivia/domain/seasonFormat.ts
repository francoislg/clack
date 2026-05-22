import type { SeasonFormat, SeasonFormatSlot } from "../core/types.js";
import {
  validateAnswersFormatMap,
  validateQuestionTypeMap,
  validateFreeformAnswerShapeMap,
  validateContextsList,
  validateTriviaDifficultyMap,
  type TriviaAnswersFormatWeights,
  type TriviaQuestionTypeWeights,
  type TriviaFreeformAnswerShapeWeights,
  type TriviaContextEntry,
  type TriviaDifficultyConfig,
} from "../../../config.js";

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Thin wrappers over the shared validators from `config.ts` — same allow-lists,
 * same normalization rules. The labels are shortened so the `upsert_season`
 * tool's error messages read naturally for Claude (the workspace-config variants
 * use longer `"Config 'trivia.*'"` labels).
 */
export function validateAnswersFormat(
  raw: Record<string, number>,
): ValidateResult<TriviaAnswersFormatWeights> {
  return validateAnswersFormatMap(raw, "answersFormat");
}

export function validateQuestionType(
  raw: Record<string, number>,
): ValidateResult<TriviaQuestionTypeWeights> {
  return validateQuestionTypeMap(raw, "questionType");
}

export function validateFreeformAnswerShape(
  raw: Record<string, number>,
): ValidateResult<TriviaFreeformAnswerShapeWeights> {
  return validateFreeformAnswerShapeMap(raw, "freeformAnswerShape");
}

export function validateContexts(raw: unknown): ValidateResult<TriviaContextEntry[]> {
  return validateContextsList(raw, "contexts");
}

export function validateDifficulty(raw: unknown): ValidateResult<TriviaDifficultyConfig> {
  return validateTriviaDifficultyMap(raw, "difficulty");
}

function dedupePreservingOrder(values: string[]): string[] {
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

interface RawSlot {
  label?: string | null;
  categories?: string[];
  answersFormat?: Record<string, number> | null;
  questionType?: Record<string, number> | null;
  freeformAnswerShape?: Record<string, number> | null;
  contexts?: unknown[] | null;
  difficulty?: unknown | null;
}

interface RawFormat {
  questions?: RawSlot[];
}

/**
 * Validate a season format. Enforces:
 *   - non-empty `questions` array
 *   - each slot's `label` (when present) is non-empty after trim
 *   - each slot's `categories` (when present) is non-empty after dedupe
 *   - each slot's `answersFormat` (when present) passes `validateAnswersFormat`
 *   - each slot's `questionType` (when present) passes `validateQuestionType`
 *   - each slot's `contexts` (when present) passes `validateContexts`
 *
 * Returns a normalized format (labels trimmed, categories deduped) on success.
 */
export function validateFormat(raw: RawFormat | null | undefined): ValidateResult<SeasonFormat> {
  if (raw === null || raw === undefined) {
    return { ok: false, error: "format must be an object" };
  }
  const questions = raw.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, error: "format.questions must be a non-empty array" };
  }
  const normalized: SeasonFormatSlot[] = [];
  for (let i = 0; i < questions.length; i++) {
    const slot = questions[i];
    const out: SeasonFormatSlot = {};
    if (slot.label !== undefined && slot.label !== null) {
      const trimmed = slot.label.trim();
      if (trimmed.length === 0) {
        return { ok: false, error: `format.questions[${i}].label must be non-empty after trim` };
      }
      out.label = trimmed;
    }
    if (slot.categories !== undefined) {
      if (!Array.isArray(slot.categories) || slot.categories.length === 0) {
        return {
          ok: false,
          error: `format.questions[${i}].categories must be a non-empty array when provided`,
        };
      }
      const deduped = dedupePreservingOrder(slot.categories.filter((c) => c.length > 0));
      if (deduped.length === 0) {
        return {
          ok: false,
          error: `format.questions[${i}].categories must contain at least one non-empty string`,
        };
      }
      out.categories = deduped;
    }
    if (slot.answersFormat !== undefined && slot.answersFormat !== null) {
      const validated = validateAnswersFormat(slot.answersFormat);
      if (!validated.ok) {
        return { ok: false, error: `format.questions[${i}]: ${validated.error}` };
      }
      out.answersFormat = validated.value;
    }
    if (slot.questionType !== undefined && slot.questionType !== null) {
      const validated = validateQuestionType(slot.questionType);
      if (!validated.ok) {
        return { ok: false, error: `format.questions[${i}]: ${validated.error}` };
      }
      out.questionType = validated.value;
    }
    if (slot.freeformAnswerShape !== undefined && slot.freeformAnswerShape !== null) {
      const validated = validateFreeformAnswerShape(slot.freeformAnswerShape);
      if (!validated.ok) {
        return { ok: false, error: `format.questions[${i}]: ${validated.error}` };
      }
      out.freeformAnswerShape = validated.value;
    }
    if (slot.contexts !== undefined && slot.contexts !== null) {
      const validated = validateContexts(slot.contexts);
      if (!validated.ok) {
        return { ok: false, error: `format.questions[${i}]: ${validated.error}` };
      }
      out.contexts = validated.value;
    }
    if (slot.difficulty !== undefined && slot.difficulty !== null) {
      const validated = validateDifficulty(slot.difficulty);
      if (!validated.ok) {
        return { ok: false, error: `format.questions[${i}]: ${validated.error}` };
      }
      out.difficulty = validated.value;
    }
    normalized.push(out);
  }
  return { ok: true, value: { questions: normalized } };
}

/**
 * Resolve the effective categories pool for a slot. Slot.categories takes precedence;
 * otherwise the season's categories. Returns `null` when neither is set (shouldn't
 * happen for a well-formed season since `categories` is required at the season level).
 */
export function resolveSlotCategories(
  slot: SeasonFormatSlot,
  seasonCategories: string[],
): string[] {
  return slot.categories ?? seasonCategories;
}

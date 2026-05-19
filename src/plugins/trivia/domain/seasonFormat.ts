import type { SeasonFormat, SeasonFormatSlot, SeasonQuestionTypeWeights } from "../core/types.js";

const QUESTION_TYPE_KEYS = ["boolean", "choice"] as const;

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate a `questionTypes` map. Returns a normalized weights object (both keys
 * present, missing keys defaulted to 0) on success.
 *
 * Rules: keys must be in {"boolean", "choice"}; values must be non-negative integers;
 * at least one value must be strictly positive.
 */
export function validateQuestionTypes(
  raw: Record<string, number>,
): ValidateResult<SeasonQuestionTypeWeights> {
  const out: Partial<SeasonQuestionTypeWeights> = {};
  let positiveCount = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!(QUESTION_TYPE_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `questionTypes contains unknown key '${key}' (allowed: ${QUESTION_TYPE_KEYS.join(", ")})`,
      };
    }
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return {
        ok: false,
        error: `questionTypes.${key} must be a non-negative integer (got ${value})`,
      };
    }
    out[key as "boolean" | "choice"] = value;
    if (value > 0) positiveCount++;
  }
  if (positiveCount === 0) {
    return { ok: false, error: "questionTypes must have at least one strictly positive weight" };
  }
  return { ok: true, value: { boolean: out.boolean ?? 0, choice: out.choice ?? 0 } };
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
  questionTypes?: Record<string, number> | null;
}

interface RawFormat {
  questions?: RawSlot[];
}

/**
 * Validate a season format. Enforces:
 *   - non-empty `questions` array
 *   - each slot's `label` (when present) is non-empty after trim
 *   - each slot's `categories` (when present) is non-empty after dedupe
 *   - each slot's `questionTypes` (when present) passes `validateQuestionTypes`
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
    if (slot.questionTypes !== undefined && slot.questionTypes !== null) {
      const validated = validateQuestionTypes(slot.questionTypes);
      if (!validated.ok) {
        return { ok: false, error: `format.questions[${i}]: ${validated.error}` };
      }
      out.questionTypes = validated.value;
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

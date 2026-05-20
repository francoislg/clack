import type {
  SeasonFormat,
  SeasonFormatSlot,
  SeasonAnswersFormatWeights,
  SeasonQuestionTypeWeights,
  SeasonContextEntry,
} from "../core/types.js";

const ANSWERS_FORMAT_KEYS = ["boolean", "choice"] as const;
const QUESTION_TYPE_KEYS = ["fact", "topical"] as const;

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate an `answersFormat` map. Returns a normalized weights object (both keys
 * present, missing keys defaulted to 0) on success.
 *
 * Rules: keys must be in {"boolean", "choice"}; values must be non-negative integers;
 * at least one value must be strictly positive.
 */
export function validateAnswersFormat(
  raw: Record<string, number>,
): ValidateResult<SeasonAnswersFormatWeights> {
  const out: Partial<SeasonAnswersFormatWeights> = {};
  let positiveCount = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!(ANSWERS_FORMAT_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `answersFormat contains unknown key '${key}' (allowed: ${ANSWERS_FORMAT_KEYS.join(", ")})`,
      };
    }
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return {
        ok: false,
        error: `answersFormat.${key} must be a non-negative integer (got ${value})`,
      };
    }
    out[key as "boolean" | "choice"] = value;
    if (value > 0) positiveCount++;
  }
  if (positiveCount === 0) {
    return { ok: false, error: "answersFormat must have at least one strictly positive weight" };
  }
  return { ok: true, value: { boolean: out.boolean ?? 0, choice: out.choice ?? 0 } };
}

/**
 * Validate a `questionType` (fact-vs-topical) map. Returns a normalized weights object
 * (both keys present, missing keys defaulted to 0) on success.
 */
export function validateQuestionType(
  raw: Record<string, number>,
): ValidateResult<SeasonQuestionTypeWeights> {
  const out: Partial<SeasonQuestionTypeWeights> = {};
  let positiveCount = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!(QUESTION_TYPE_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `questionType contains unknown key '${key}' (allowed: ${QUESTION_TYPE_KEYS.join(", ")})`,
      };
    }
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return {
        ok: false,
        error: `questionType.${key} must be a non-negative integer (got ${value})`,
      };
    }
    out[key as "fact" | "topical"] = value;
    if (value > 0) positiveCount++;
  }
  if (positiveCount === 0) {
    return { ok: false, error: "questionType must have at least one strictly positive weight" };
  }
  return { ok: true, value: { fact: out.fact ?? 0, topical: out.topical ?? 0 } };
}

interface RawContextEntry {
  name?: unknown;
  weight?: unknown;
}

/**
 * Validate a contexts list. Returns a normalized array on success.
 *
 * Rules: array must be non-empty; every entry has a string `name` (empty string allowed);
 * `weight` (when present) is a positive number; names are unique.
 */
export function validateContexts(raw: RawContextEntry[]): ValidateResult<SeasonContextEntry[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "contexts must be a non-empty array when present" };
  }
  const out: SeasonContextEntry[] = [];
  const seenNames = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry.name !== "string") {
      return { ok: false, error: `contexts[${i}].name must be a string` };
    }
    if (seenNames.has(entry.name)) {
      return { ok: false, error: `contexts[${i}] has duplicate name '${entry.name}'` };
    }
    seenNames.add(entry.name);
    let weight: number | undefined;
    if (entry.weight !== undefined) {
      if (typeof entry.weight !== "number" || !Number.isFinite(entry.weight) || entry.weight <= 0) {
        return {
          ok: false,
          error: `contexts[${i}].weight must be a positive number (got ${String(entry.weight)})`,
        };
      }
      weight = entry.weight;
    }
    out.push(weight === undefined ? { name: entry.name } : { name: entry.name, weight });
  }
  return { ok: true, value: out };
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
  contexts?: RawContextEntry[] | null;
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
    if (slot.contexts !== undefined && slot.contexts !== null) {
      const validated = validateContexts(slot.contexts);
      if (!validated.ok) {
        return { ok: false, error: `format.questions[${i}]: ${validated.error}` };
      }
      out.contexts = validated.value;
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

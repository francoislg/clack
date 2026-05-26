/**
 * Pure validator for the `format` field on both season entries and game entries.
 * Lives in `configParsers/` (next to `axes.ts`) so the workspace-tier parser
 * (`parseTriviaGames`) can use it without depending on `domain/`. The slot-by-slot
 * walker delegates to the same axis validators that `parseTriviaAxisBag` uses.
 */

import type { SeasonFormat, SeasonFormatSlot } from "../configTypes.js";
import {
  validateAnswersFormatMap,
  validateQuestionTypeMap,
  validateFreeformAnswerShapeMap,
  validateContextsList,
  validateTriviaDifficultyMap,
  validateTriviaDifficultyRatioMap,
  type Result,
} from "./axes.js";

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
  difficultyRatio?: unknown | null;
}

interface RawFormat {
  questions?: RawSlot[];
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
    const slot = questions[i];
    const slotLabel = `${fieldLabel}.questions[${i}]`;
    const out: SeasonFormatSlot = {};
    if (slot.label !== undefined && slot.label !== null) {
      const trimmed = slot.label.trim();
      if (trimmed.length === 0) {
        return { ok: false, error: `'${slotLabel}.label' must be non-empty after trim` };
      }
      out.label = trimmed;
    }
    if (slot.categories !== undefined) {
      if (!Array.isArray(slot.categories) || slot.categories.length === 0) {
        return {
          ok: false,
          error: `'${slotLabel}.categories' must be a non-empty array when provided`,
        };
      }
      const deduped = dedupePreservingOrder(slot.categories.filter((c) => c.length > 0));
      if (deduped.length === 0) {
        return {
          ok: false,
          error: `'${slotLabel}.categories' must contain at least one non-empty string`,
        };
      }
      out.categories = deduped;
    }
    if (slot.answersFormat !== undefined && slot.answersFormat !== null) {
      const validated = validateAnswersFormatMap(slot.answersFormat, `${slotLabel}.answersFormat`);
      if (!validated.ok) return validated;
      out.answersFormat = validated.value;
    }
    if (slot.questionType !== undefined && slot.questionType !== null) {
      const validated = validateQuestionTypeMap(slot.questionType, `${slotLabel}.questionType`);
      if (!validated.ok) return validated;
      out.questionType = validated.value;
    }
    if (slot.freeformAnswerShape !== undefined && slot.freeformAnswerShape !== null) {
      const validated = validateFreeformAnswerShapeMap(
        slot.freeformAnswerShape,
        `${slotLabel}.freeformAnswerShape`,
      );
      if (!validated.ok) return validated;
      out.freeformAnswerShape = validated.value;
    }
    if (slot.contexts !== undefined && slot.contexts !== null) {
      const validated = validateContextsList(slot.contexts, `${slotLabel}.contexts`);
      if (!validated.ok) return validated;
      out.contexts = validated.value;
    }
    if (slot.difficulty !== undefined && slot.difficulty !== null) {
      const validated = validateTriviaDifficultyMap(slot.difficulty, `${slotLabel}.difficulty`);
      if (!validated.ok) return validated;
      out.difficulty = validated.value;
    }
    if (slot.difficultyRatio !== undefined && slot.difficultyRatio !== null) {
      const validated = validateTriviaDifficultyRatioMap(
        slot.difficultyRatio,
        `${slotLabel}.difficultyRatio`,
      );
      if (!validated.ok) return validated;
      out.difficultyRatio = validated.value;
    }
    normalized.push(out);
  }
  return { ok: true, value: { questions: normalized } };
}

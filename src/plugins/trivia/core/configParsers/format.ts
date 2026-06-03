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
  triviaDifficultyRatioZod,
  triviaHintZod,
  triviaJudgeLeniencyZod,
  validateAnswersFormatMap,
  validateContextsList,
  validateFreeformAnswerShapeMap,
  validateHintConfig,
  validateJudgeLeniency,
  validateQuestionTypeMap,
  validatePromptMediumMap,
  validateTriviaDifficultyMap,
  validateTriviaDifficultyRatioMap,
  type Result,
} from "./axes.js";

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

/**
 * Validate the per-tier `additionalInstructions` field (cumulative-cascade axis
 * defined in the `trivia-prompt-instructions` capability). Trims, rejects empty /
 * whitespace-only.
 */
export function normalizeAdditionalInstructions(raw: string): Result<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "additionalInstructions must be non-empty (pass null to clear)." };
  }
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

interface RawSlot {
  label?: string | null;
  categories?: string[];
  answersFormat?: Record<string, number> | null;
  questionType?: Record<string, number> | null;
  promptMedium?: Record<string, number> | null;
  freeformAnswerShape?: Record<string, number> | null;
  contexts?: unknown[] | null;
  difficulty?: unknown | null;
  difficultyRatio?: unknown | null;
  liveAnswersVisible?: boolean | null;
  /** Permissive at the parse boundary — narrowed by `isRevealResponsesMode` at runtime. */
  revealResponses?: string | null;
  instructions?: string | null;
  additionalInstructions?: string | null;
  hint?: unknown | null;
  judgeLeniency?: unknown | null;
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
    const r = validateSlotConfig(questions[i], `${fieldLabel}.questions[${i}]`);
    if (!r.ok) return r;
    normalized.push(r.value);
  }
  return { ok: true, value: { questions: normalized } };
}

/**
 * Validate one slot's per-axis overrides (the shape shared by a format slot and a season
 * `slotOverrides` entry). Returns the normalized `SeasonFormatSlot` or a labeled error.
 */
export function validateSlotConfig(slot: RawSlot, slotLabel: string): Result<SeasonFormatSlot> {
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
  if (slot.promptMedium !== undefined && slot.promptMedium !== null) {
    const validated = validatePromptMediumMap(slot.promptMedium, `${slotLabel}.promptMedium`);
    if (!validated.ok) return validated;
    out.promptMedium = validated.value;
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
  if (slot.liveAnswersVisible !== undefined && slot.liveAnswersVisible !== null) {
    if (typeof slot.liveAnswersVisible !== "boolean") {
      return {
        ok: false,
        error: `'${slotLabel}.liveAnswersVisible' must be a boolean`,
      };
    }
    out.liveAnswersVisible = slot.liveAnswersVisible;
  }
  if (slot.revealResponses !== undefined && slot.revealResponses !== null) {
    if (isRevealResponsesMode(slot.revealResponses)) {
      out.revealResponses = slot.revealResponses;
    } else {
      return {
        ok: false,
        error: `'${slotLabel}.revealResponses' must be one of "no", "just-winners", "just-correctness", "yes"`,
      };
    }
  }
  if (slot.instructions !== undefined && slot.instructions !== null) {
    if (typeof slot.instructions !== "string") {
      return { ok: false, error: `'${slotLabel}.instructions' must be a string` };
    }
    const trimmed = slot.instructions.trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        error: `'${slotLabel}.instructions' must be non-empty after trim`,
      };
    }
    out.instructions = trimmed;
  }
  if (slot.additionalInstructions !== undefined && slot.additionalInstructions !== null) {
    if (typeof slot.additionalInstructions !== "string") {
      return { ok: false, error: `'${slotLabel}.additionalInstructions' must be a string` };
    }
    const trimmed = slot.additionalInstructions.trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        error: `'${slotLabel}.additionalInstructions' must be non-empty after trim`,
      };
    }
    out.additionalInstructions = trimmed;
  }
  if (slot.hint !== undefined && slot.hint !== null) {
    const validated = validateHintConfig(slot.hint, `${slotLabel}.hint`);
    if (!validated.ok) return validated;
    out.hint = validated.value;
  }
  if (slot.judgeLeniency !== undefined && slot.judgeLeniency !== null) {
    const validated = validateJudgeLeniency(slot.judgeLeniency, `${slotLabel}.judgeLeniency`);
    if (!validated.ok) return validated;
    out.judgeLeniency = validated.value;
  }
  return { ok: true, value: out };
}

/**
 * Validate a season `slotOverrides` map — each value is a per-slot axis bag validated
 * exactly like a format slot. The map shape (object, integer-string keys) is enforced by
 * the caller's zod schema (`slotOverridesZod`); this only runs the per-slot semantics.
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

const seasonFormatSlotZod = z.object({
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
  hint: triviaHintZod.optional(),
  judgeLeniency: triviaJudgeLeniencyZod.optional(),
});

/**
 * Shared zod schema for the `format` field carried by both `SeasonEntry` and
 * `TriviaGame`. The shape is the same at both tiers — only the cascade order
 * differs. Used by `upsert_season` and `upsert_game`.
 */
export const seasonFormatZod = z.object({
  questions: z.array(seasonFormatSlotZod),
});

/**
 * Shared zod schema for a season's `slotOverrides` map: integer-string keys → partial
 * slot bags. Deep per-axis semantics are validated by `validateSlotOverrides`.
 */
export const slotOverridesZod = z.record(z.string().regex(/^\d+$/), seasonFormatSlotZod);

/** Shared zod schema for the per-tier `categories` field. */
export const triviaCategoriesZod = z.array(z.string());

/** Shared zod schema for the per-tier `theme` field. */
export const triviaThemeZod = z.string();

/** Shared zod schema for the per-tier `instructions` field (replace cascade). */
export const triviaInstructionsZod = z.string();

/** Shared zod schema for the per-tier `additionalInstructions` field (cumulative cascade). */
export const triviaAdditionalInstructionsZod = z.string();

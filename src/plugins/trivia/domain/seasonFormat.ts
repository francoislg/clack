import {
  validateAnswersFormatMap,
  validateQuestionTypeMap,
  validatePromptMediumMap,
  validateFreeformAnswerShapeMap,
  validateContextsList,
  validateTriviaDifficultyMap,
  validateTriviaDifficultyRatioMap,
} from "../core/configParsers/axes.js";
import type {
  SeasonFormatSlot,
  TriviaAnswersFormatWeights,
  TriviaQuestionTypeWeights,
  PromptMediumWeights,
  TriviaFreeformAnswerShapeWeights,
  TriviaContextEntry,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
} from "../core/configTypes.js";
import { type Result } from "../../../plugins-sdk/sdk.js";

/**
 * Thin wrappers over the shared validators from `config.ts` — same allow-lists,
 * same normalization rules. The labels are shortened so the `upsert_season`
 * tool's error messages read naturally for Claude (the workspace-config variants
 * use longer `"Config 'trivia.*'"` labels).
 */
export function validateAnswersFormat(
  raw: Record<string, number>,
): Result<TriviaAnswersFormatWeights> {
  return validateAnswersFormatMap(raw, "answersFormat");
}

export function validateQuestionType(
  raw: Record<string, number>,
): Result<TriviaQuestionTypeWeights> {
  return validateQuestionTypeMap(raw, "questionType");
}

export function validatePromptMedium(raw: Record<string, number>): Result<PromptMediumWeights> {
  return validatePromptMediumMap(raw, "promptMedium");
}

export function validateFreeformAnswerShape(
  raw: Record<string, number>,
): Result<TriviaFreeformAnswerShapeWeights> {
  return validateFreeformAnswerShapeMap(raw, "freeformAnswerShape");
}

export function validateContexts(raw: unknown): Result<TriviaContextEntry[]> {
  return validateContextsList(raw, "contexts");
}

export function validateDifficulty(raw: unknown): Result<TriviaDifficultyConfig> {
  return validateTriviaDifficultyMap(raw, "difficulty");
}

export function validateDifficultyRatio(raw: unknown): Result<TriviaDifficultyRatioConfig> {
  return validateTriviaDifficultyRatioMap(raw, "difficultyRatio");
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

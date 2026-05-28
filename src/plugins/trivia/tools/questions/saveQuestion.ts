import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { ANSWER_TYPE_SAVE_FIELD_NAMES, getAnswerTypeHandler } from "../../answerTypes/registry.js";
import {
  SAVE_QUESTION_HANDLER_FIELDS,
  type SaveQuestionArgs,
} from "../../answerTypes/saveSchema.js";
import type { TriviaQuestionBase } from "../../answerTypes/types.js";
import {
  QUESTION_TYPE_SAVE_FIELD_NAMES,
  getQuestionTypeHandler,
} from "../../questionTypes/registry.js";
import type { TriviaGame } from "../../core/configTypes.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { resolveAnswersFormat } from "../../domain/questionTypes.js";
import { resolveQuestionType } from "../../domain/factTopical.js";
import { resolveContexts } from "../../domain/contexts.js";
import { resolveEffectiveFormat } from "../../domain/format.js";
import { resolveActiveCategoriesWithSource } from "../../domain/categories.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer } from "../../core/types.js";

/**
 * Locate the first foreign-tier field on the supplied args — i.e. a field
 * belonging to a tier OTHER than `activeTier` that the caller populated.
 * Returns `{ field, tier }` for the offender or `null` when clean.
 *
 * Generic over the tier union so callers retain literal narrowing on `tier`
 * (used by `save_question` to format the error message with the format /
 * question-type names from the registry).
 */
function findForeignField<TTier extends string>(
  args: SaveQuestionArgs,
  fieldNamesByTier: Record<TTier, readonly string[]>,
  activeTier: TTier,
): { field: string; tier: TTier } | null {
  const ownFields = new Set(fieldNamesByTier[activeTier]);
  for (const tier in fieldNamesByTier) {
    if (tier === activeTier) continue;
    for (const field of fieldNamesByTier[tier]) {
      if (ownFields.has(field)) continue;
      if (args[field as keyof SaveQuestionArgs] !== undefined) {
        return { field, tier };
      }
    }
  }
  return null;
}

const DESCRIPTION = `Save a new trivia question.

Three shapes are accepted, determined by \`answersFormat\`:

BOOLEAN (\`answersFormat: "boolean"\`):
- Required: \`category\`, \`statement\`, \`questionType\`, \`isTrue\`, \`emojis\`.
- The stored record carries \`answersFormat: "boolean"\` and \`isTrue\`; no \`choices\`/\`correctIndex\`/\`expectedAnswer\`.

CHOICE (\`answersFormat: "choice"\`):
- Required: \`category\`, \`statement\`, \`questionType\`, \`emojis\`, \`choices\` (string[], length within active [min, max]), \`correctIndex\` (0-based).
- The stored record carries \`answersFormat: "choice"\`, \`choices\`, and \`correctIndex\`; no \`isTrue\`/\`expectedAnswer\`.
- Exactly ONE correct answer per question — validated at this tool's boundary.

FREEFORM (\`answersFormat: "freeform"\`):
- Required: \`category\`, \`statement\`, \`questionType\`, \`emojis\`, \`expectedAnswer\` (the canonical correct answer, ≤ 200 chars), \`freeformAnswerShape\` (the shape rolled by \`get_ideas\` — pass it straight through, do NOT re-pick).
- Optional: \`acceptableAnswers\` (string[] of pre-enumerated valid variants the reveal-time judge should also accept), \`gradingNotes\` (one short sentence refining acceptance — e.g. "Accept any major Canadian city").
- The stored record carries \`answersFormat: "freeform"\`, \`expectedAnswer\`, and \`freeformAnswerShape\`; no \`isTrue\`/\`choices\`/\`correctIndex\`. The user types their answer into a Slack modal; a small fast model judges submissions at reveal time, rejecting multi-guess "shotgun" answers (e.g. "Paris or London") as incorrect even when one guess matches.

ADDITIONAL FIELDS (all shapes):
- \`questionType\` (REQUIRED): \`"fact"\` or \`"topical"\`. Must match the value rolled by \`get_ideas\`.
- \`sourceUrl\` (REQUIRED when \`questionType: "topical"\`, FORBIDDEN when \`questionType: "fact"\`): HTTPS citation URL.
- \`eventDate\` (OPTIONAL, only when \`questionType: "topical"\`): ISO 8601 calendar date (YYYY-MM-DD).
- \`context\` (OPTIONAL): the lens name used (from \`contextPriority\`). Empty string omits the field on the record. Non-empty values must appear in the active \`contexts\` list.

Validation rejects: out-of-range correctIndex; duplicate or whitespace/case-equivalent choices; choices outside the configured \`trivia.choices.{min, max}\` bounds; choice strings outside 1–40 chars after trim; cross-format field collisions (e.g. \`isTrue\` with \`answersFormat: "choice"\`, \`expectedAnswer\` with \`"boolean"\`, \`choices\` with \`"freeform"\`); freeform without \`expectedAnswer\` or with \`expectedAnswer\` over 200 chars; topical without sourceUrl; sourceUrl on fact; non-HTTPS sourceUrl; eventDate without topical; malformed eventDate; context not in the active contexts list.`;

export function createSaveQuestionTool(
  data: TriviaDataLayer,
  getConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "save_question",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). Determines which game's per-game data file receives the new question.",
        ),
      // Every other field is sourced from the shared handler schema so the
      // tool's args type and the handler's `SaveQuestionArgs` can't drift.
      ...SAVE_QUESTION_HANDLER_FIELDS,
    },
    async (args) => {
      let gameEntry: TriviaGame;
      try {
        gameEntry = requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      if (args.statement.length < 10) {
        return errorResult("Statement must be at least 10 characters");
      }
      if (args.statement.length > 500) {
        return errorResult("Statement must be at most 500 characters");
      }
      if (args.emojis.length < 1 || args.emojis.length > 4) {
        return errorResult("Must provide 1-4 emojis");
      }
      let normalizedHint: { mode: "button" | "inline"; text: string } | undefined;
      if (args.hint !== undefined) {
        const trimmed = args.hint.text.trim();
        if (trimmed.length === 0) {
          return errorResult(
            "Hint text must be non-empty after trim — omit the hint field instead.",
          );
        }
        if (trimmed.length > 140) {
          return errorResult(
            `Hint text must be ≤140 characters after trim (got ${trimmed.length}).`,
          );
        }
        normalizedHint = { mode: args.hint.mode, text: trimmed };
      }

      const answersFormat = args.answersFormat;
      const questionType = args.questionType;
      const handler = getAnswerTypeHandler(answersFormat);
      const questionTypeHandler = getQuestionTypeHandler(questionType);

      // Central cross-axis collision checks. For every OTHER tier on either
      // axis, ensure the incoming args don't carry that tier's fields. This
      // replaces the per-handler "MUST NOT include X" rejections — adding a
      // new answer-format or question-type no longer touches sibling handlers.
      const formatCollision = findForeignField(args, ANSWER_TYPE_SAVE_FIELD_NAMES, answersFormat);
      if (formatCollision !== null) {
        return errorResult(
          `"${formatCollision.field}" is not permitted on ${answersFormat} questions (it belongs to ${formatCollision.tier}).`,
        );
      }
      const typeCollision = findForeignField(args, QUESTION_TYPE_SAVE_FIELD_NAMES, questionType);
      if (typeCollision !== null) {
        return errorResult(
          `"${typeCollision.field}" is not permitted on ${questionType} questions (it belongs to ${typeCollision.tier}).`,
        );
      }

      // Per-tier positive validation for the questionType axis. Topical asserts
      // sourceUrl presence/shape + optional eventDate format; fact is a no-op.
      const questionTypeOutcome = questionTypeHandler.validate(args);
      if (!questionTypeOutcome.ok) return errorResult(questionTypeOutcome.error);

      const scoped = data.forGame(args.game);
      const seasonsState = await scoped.loadSeasonsState();
      const currentSeasonEntry = findCurrentSeason(seasonsState, Date.now());
      const effectiveFormat = resolveEffectiveFormat(currentSeasonEntry, gameEntry);
      const formatSource: "season" | "game" | null =
        currentSeasonEntry?.format !== undefined
          ? "season"
          : gameEntry.format !== undefined
            ? "game"
            : null;

      if (effectiveFormat !== null) {
        if (args.slot === undefined) {
          const sourceLabel =
            formatSource === "season"
              ? `Season "${currentSeasonEntry?.slug}"`
              : `Game "${gameEntry.name}"`;
          return errorResult(
            `${sourceLabel} has a format with ${effectiveFormat.questions.length} slot(s) — save_question requires a slot argument.`,
          );
        }
        if (args.slot.index < 0 || args.slot.index >= effectiveFormat.questions.length) {
          const sourceLabel =
            formatSource === "season"
              ? `active season "${currentSeasonEntry?.slug}"`
              : `game "${gameEntry.name}"`;
          return errorResult(
            `slot index ${args.slot.index} out of range — ${sourceLabel} has ${effectiveFormat.questions.length} slot(s).`,
          );
        }
      } else if (args.slot !== undefined) {
        return errorResult(
          "no active format — save_question must be called WITHOUT a slot argument.",
        );
      }

      const globalCategories = await data.loadCategories();
      const config = getConfigFn();
      const slotIndexForResolution =
        effectiveFormat !== null && args.slot !== undefined ? args.slot.index : null;

      const { pool: slotCategories, source: categoriesSource } = resolveActiveCategoriesWithSource(
        effectiveFormat,
        slotIndexForResolution,
        currentSeasonEntry,
        gameEntry,
        globalCategories,
      );
      const categoryLower = args.category.toLowerCase();
      const matchingCategory = slotCategories.find((c) => c.toLowerCase() === categoryLower);

      if (!matchingCategory) {
        const errorPayload = {
          code: "CATEGORY_NOT_IN_POOL" as const,
          source: categoriesSource,
          categories: slotCategories,
          message: `Category "${args.category}" is not in the resolved pool (source: "${categoriesSource}", ${slotCategories.length} categories). Use add_categories to add it; if the source is "season" or "slot" and you want a broader pool, consider clearing inheritance via upsert_season.`,
        };
        return errorResult(JSON.stringify(errorPayload));
      }

      if (effectiveFormat !== null && args.slot !== undefined) {
        const slotAnswersWeights = resolveAnswersFormat(
          currentSeasonEntry,
          args.slot.index,
          gameEntry,
          config,
        );
        const weightForAnswers = slotAnswersWeights[answersFormat];
        if (weightForAnswers <= 0) {
          return errorResult(
            `Slot ${args.slot.index} does not permit "${answersFormat}" answers (answersFormat for this slot has zero weight on "${answersFormat}"). Re-roll get_ideas — its suggestedAnswersFormat reflects the slot's permitted formats.`,
          );
        }
        const slotQuestionTypeWeights = resolveQuestionType(
          currentSeasonEntry,
          args.slot.index,
          gameEntry,
          config,
        );
        const weightForQuestionType = slotQuestionTypeWeights[questionType];
        if (weightForQuestionType <= 0) {
          return errorResult(
            `Slot ${args.slot.index} does not permit "${questionType}" questions (questionType for this slot has zero weight on "${questionType}"). Re-roll get_ideas — its suggestedQuestionType reflects the slot's permitted types.`,
          );
        }
      }

      // Context validation
      const resolvedContexts = resolveContexts(
        currentSeasonEntry,
        slotIndexForResolution,
        gameEntry,
        config,
      );
      let storedContext: string | null = null;
      if (args.context !== undefined && args.context.length > 0) {
        if (resolvedContexts === null) {
          return errorResult(
            `"context" was provided but no contexts are configured for this slot/season/config. Remove the context argument or configure contexts first.`,
          );
        }
        if (!resolvedContexts.some((c) => c.name === args.context)) {
          const available = resolvedContexts.map((c) => `"${c.name}"`).join(", ");
          return errorResult(
            `Context "${args.context}" is not in the active contexts list (${available}).`,
          );
        }
        storedContext = args.context;
      }

      const currentSeasonSlug = currentSeasonEntry?.slug ?? null;
      const slotStamp =
        effectiveFormat !== null && args.slot !== undefined
          ? {
              index: args.slot.index,
              ...(effectiveFormat.questions[args.slot.index].label !== undefined
                ? { label: effectiveFormat.questions[args.slot.index].label as string }
                : {}),
            }
          : null;
      const base: TriviaQuestionBase = {
        id: randomUUID(),
        category: matchingCategory,
        statement: args.statement,
        answersFormat,
        questionType,
        emojis: args.emojis,
        createdAt: Date.now(),
        ...(currentSeasonSlug !== null ? { season: currentSeasonSlug } : {}),
        ...(slotStamp !== null ? { slot: slotStamp } : {}),
        ...(args.suggestedDifficulty !== undefined
          ? { suggestedDifficulty: args.suggestedDifficulty }
          : {}),
        ...(args.difficulty !== undefined ? { difficulty: args.difficulty } : {}),
        ...(storedContext !== null ? { context: storedContext } : {}),
        ...(normalizedHint !== undefined ? { hint: normalizedHint } : {}),
        ...questionTypeOutcome.recordExtras,
      };

      // Handler validates per-format args AND attaches its format-specific
      // fields (isTrue / choices+correctIndex / expectedAnswer+...) in one
      // step — no two-method dance, no opportunity to skip validation.
      const outcome = handler.getSavedQuestion(base, args, { config: getConfigFn() });
      if (!outcome.ok) {
        return errorResult(outcome.error);
      }

      await scoped.saveQuestion(outcome.question);

      return textResult({ saved: true, question: outcome.question });
    },
  );
}

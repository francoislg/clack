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
import { resolveCascade } from "../../domain/resolveCascade.js";
import { buildCascadeContext } from "../../domain/cascadeContext.js";
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

PROMPT MEDIUM (all shapes):
- \`promptMedium\` (OPTIONAL): \`"text"\` (default) or \`"image"\`. Pass the value rolled by \`get_ideas\`. Composes freely with every \`answersFormat\` — no cross-axis restriction.
- \`media\` (REQUIRED when \`promptMedium: "image"\`, FORBIDDEN otherwise): \`{ kind: "image", url, altText, subjectId, title, license?, attribution? }\`. \`url\` MUST be HTTPS (the image-search tool's \`imageUrl\`); \`altText\` ≤ 2000 chars.

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
      promptMedium: z
        .enum(["text", "image"])
        .optional()
        .describe(
          'Prompt-delivery medium rolled by get_ideas. "text" (or omitted) = a normal text-prompted question. "image" = an image-prompted question; you MUST also pass `media`. Composes freely with every answersFormat (boolean/choice/freeform).',
        ),
      media: z
        .object({
          kind: z.literal("image"),
          url: z
            .string()
            .describe("Upstream HTTPS image URL (the image-search tool's `imageUrl`)."),
          altText: z
            .string()
            .describe(
              "Accessibility text describing the image (≤2000 chars, no Block Kit markup).",
            ),
          subjectId: z
            .string()
            .describe(
              "Source-namespaced dedup key from the image-search tool (e.g. `wikidata:Q243`).",
            ),
          title: z.string().describe("Canonical subject title from the image-search tool."),
          license: z.string().optional(),
          attribution: z.string().optional(),
        })
        .optional()
        .describe(
          'Image payload — REQUIRED when promptMedium is "image", FORBIDDEN otherwise. Sourced from the image-search tool\'s metadata block.',
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

      // promptMedium axis: validate media presence/shape against the rolled medium.
      // No cross-axis constraint with answersFormat — every combo is permitted.
      const promptMedium = args.promptMedium ?? "text";
      if (promptMedium === "image") {
        if (args.media === undefined) {
          return errorResult('promptMedium "image" requires a `media` object.');
        }
        const m = args.media;
        const missing = (["url", "altText", "subjectId", "title"] as const).filter(
          (k) => m[k].trim().length === 0,
        );
        if (missing.length > 0) {
          return errorResult(`media.${missing[0]} must be a non-empty string.`);
        }
        if (!/^https:\/\//i.test(m.url)) {
          return errorResult("media.url must be an HTTPS URL.");
        }
        if (m.altText.length > 2000) {
          return errorResult(
            `media.altText must be ≤2000 characters (Slack alt_text limit; got ${m.altText.length}).`,
          );
        }
        // Defense-in-depth: strip Slack control sequences (mentions / channel /
        // special pings) from altText so the posted image block can't ping anyone.
        const cleanedAltText = m.altText.replace(/<[@#!][^>]*>/g, "").trim();
        if (cleanedAltText.length === 0) {
          return errorResult("media.altText must be non-empty after stripping Block Kit markup.");
        }
        args.media = { ...m, altText: cleanedAltText };
      } else if (args.media !== undefined) {
        return errorResult('`media` is only permitted when promptMedium is "image".');
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
      const cascadeCtx = buildCascadeContext(
        currentSeasonEntry,
        gameEntry,
        slotIndexForResolution,
        config,
      );

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
        const slotAnswersWeights = resolveCascade("answersFormat", cascadeCtx).value;
        const weightForAnswers = slotAnswersWeights[answersFormat];
        if (weightForAnswers <= 0) {
          return errorResult(
            `Slot ${args.slot.index} does not permit "${answersFormat}" answers (answersFormat for this slot has zero weight on "${answersFormat}"). Re-roll get_ideas — its suggestedAnswersFormat reflects the slot's permitted formats.`,
          );
        }
        const slotQuestionTypeWeights = resolveCascade("questionType", cascadeCtx).value;
        const weightForQuestionType = slotQuestionTypeWeights[questionType];
        if (weightForQuestionType <= 0) {
          return errorResult(
            `Slot ${args.slot.index} does not permit "${questionType}" questions (questionType for this slot has zero weight on "${questionType}"). Re-roll get_ideas — its suggestedQuestionType reflects the slot's permitted types.`,
          );
        }
      }

      // Context validation
      const resolvedContexts = resolveCascade("contexts", cascadeCtx).value;
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

      // judgeLeniency axis: resolve the effective preset from the cascade and hand it to
      // the handler. WHICH formats stamp it (freeform only) and WHEN (non-default) is the
      // handler's call — save_question doesn't branch on the format string.
      const resolvedJudgeLeniency = resolveCascade("judgeLeniency", cascadeCtx).value;

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

      // The questionType handler owns WHETHER the answer key is required at save time
      // and delegates to the matching answersFormat save path: fact/topical use the
      // keyed save; prediction defers (no key — `settle_question` stamps it later, and
      // `resolved: false` rode in on the questionType handler's recordExtras above).
      // save_question never branches on the type itself.
      const saveCtx = { config: getConfigFn(), resolvedJudgeLeniency };
      const outcome = questionTypeHandler.composeSavedQuestion(handler, base, args, saveCtx);
      if (!outcome.ok) {
        return errorResult(outcome.error);
      }

      // Stamp the prompt-medium axis onto the record. promptMedium is always set
      // (even "text", so new rows always carry it); media only on image medium.
      const finalQuestion = {
        ...outcome.question,
        promptMedium,
        ...(promptMedium === "image" && args.media !== undefined ? { media: args.media } : {}),
      };

      await scoped.saveQuestion(finalQuestion);

      return textResult({ saved: true, question: finalQuestion });
    },
  );
}

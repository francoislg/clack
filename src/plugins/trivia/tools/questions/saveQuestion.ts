import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { type TriviaGame, DEFAULT_TRIVIA_CHOICES } from "../../core/configTypes.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { resolveAnswersFormat } from "../../domain/questionTypes.js";
import { resolveQuestionType } from "../../domain/factTopical.js";
import { resolveContexts } from "../../domain/contexts.js";
import { resolveSlotCategories } from "../../domain/seasonFormat.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
- Required: \`category\`, \`statement\`, \`questionType\`, \`emojis\`, \`expectedAnswer\` (the canonical correct answer, ≤ 200 chars).
- Optional: \`acceptableAnswers\` (string[] of pre-enumerated valid variants the reveal-time judge should also accept), \`gradingNotes\` (one short sentence refining acceptance — e.g. "Accept any major Canadian city").
- The stored record carries \`answersFormat: "freeform"\` and \`expectedAnswer\`; no \`isTrue\`/\`choices\`/\`correctIndex\`. The user types their answer into a Slack modal; a small fast model judges submissions at reveal time, rejecting multi-guess "shotgun" answers (e.g. "Paris or London") as incorrect even when one guess matches.

ADDITIONAL FIELDS (all shapes):
- \`questionType\` (REQUIRED): \`"fact"\` or \`"topical"\`. Must match the value rolled by \`get_ideas\`.
- \`sourceUrl\` (REQUIRED when \`questionType: "topical"\`, FORBIDDEN when \`questionType: "fact"\`): HTTPS citation URL.
- \`eventDate\` (OPTIONAL, only when \`questionType: "topical"\`): ISO 8601 calendar date (YYYY-MM-DD).
- \`context\` (OPTIONAL): the lens name used (from \`contextPriority\`). Empty string omits the field on the record. Non-empty values must appear in the active \`contexts\` list.

Validation rejects: out-of-range correctIndex; duplicate or whitespace/case-equivalent choices; choices outside the configured \`trivia.choices.{min, max}\` bounds; choice strings outside 1–100 chars after trim; cross-format field collisions (e.g. \`isTrue\` with \`answersFormat: "choice"\`, \`expectedAnswer\` with \`"boolean"\`, \`choices\` with \`"freeform"\`); freeform without \`expectedAnswer\` or with \`expectedAnswer\` over 200 chars; topical without sourceUrl; sourceUrl on fact; non-HTTPS sourceUrl; eventDate without topical; malformed eventDate; context not in the active contexts list.`;

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
      answersFormat: z
        .enum(["boolean", "choice", "freeform"])
        .describe('Answer shape: "boolean", "choice", or "freeform" (user types the answer).'),
      questionType: z
        .enum(["fact", "topical"])
        .describe(
          'Source axis: "fact" for static knowledge, "topical" for recent events (requires sourceUrl).',
        ),
      category: z.string().describe("The category from the pool (must exist)"),
      statement: z.string().describe("The trivia statement"),
      isTrue: z
        .boolean()
        .optional()
        .describe(
          'REQUIRED for boolean questions. MUST NOT be set when answersFormat is "choice" or "freeform".',
        ),
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
      expectedAnswer: z
        .string()
        .optional()
        .describe(
          'REQUIRED for freeform questions: the canonical answer (shortest 100%-correct form). MUST NOT be set when answersFormat is "boolean" or "choice".',
        ),
      acceptableAnswers: z
        .array(z.string())
        .optional()
        .describe(
          'OPTIONAL on freeform questions: pre-enumerated semantic variants the judge should also accept. MUST NOT be set when answersFormat is "boolean" or "choice".',
        ),
      gradingNotes: z
        .string()
        .optional()
        .describe(
          'OPTIONAL on freeform questions: a one-sentence hint to the reveal-time judge about edge cases (e.g. "Accept any major Canadian city"). MUST NOT be set when answersFormat is "boolean" or "choice".',
        ),
      sourceUrl: z
        .string()
        .optional()
        .describe(
          'REQUIRED when questionType is "topical" (HTTPS URL). FORBIDDEN when questionType is "fact".',
        ),
      eventDate: z
        .string()
        .optional()
        .describe(
          "OPTIONAL on topical questions: ISO 8601 calendar date of the event (YYYY-MM-DD). Forbidden on fact questions.",
        ),
      context: z
        .string()
        .optional()
        .describe(
          "OPTIONAL: the lens (from contextPriority) used to generate the question. Empty string = no lens. Non-empty must appear in the active contexts list at this slot/season/config tier.",
        ),
      suggestedDifficulty: z
        .enum(["Easy", "Medium", "Hard"])
        .optional()
        .describe(
          "The difficulty bucket targeted at gen time (from get_ideas' suggestedDifficulty).",
        ),
      difficulty: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Your 1–10 self-rating from the difficulty gate."),
      emojis: z.array(z.string()).describe("1-4 topic-relevant emojis"),
      slot: z
        .object({
          index: z.number().int().nonnegative(),
          label: z.string().optional(),
        })
        .optional()
        .describe(
          "REQUIRED when the active season has a `format`; MUST BE OMITTED when the active season has no format. `index` selects which slot this question fills; `label` is informational (the stored record snapshots the label from format.questions[index].label, not from this argument).",
        ),
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

      const answersFormat = args.answersFormat;
      const questionType = args.questionType;

      // Validate answersFormat-discriminated fields
      if (answersFormat === "boolean") {
        if (args.isTrue === undefined) {
          return errorResult('Boolean questions require "isTrue".');
        }
        if (args.choices !== undefined) {
          return errorResult('Boolean questions must not include "choices".');
        }
        if (args.correctIndex !== undefined) {
          return errorResult('Boolean questions must not include "correctIndex".');
        }
        if (args.expectedAnswer !== undefined) {
          return errorResult('Boolean questions must not include "expectedAnswer".');
        }
        if (args.acceptableAnswers !== undefined) {
          return errorResult('Boolean questions must not include "acceptableAnswers".');
        }
        if (args.gradingNotes !== undefined) {
          return errorResult('Boolean questions must not include "gradingNotes".');
        }
      } else if (answersFormat === "choice") {
        if (args.isTrue !== undefined) {
          return errorResult('Choice questions must not include "isTrue".');
        }
        if (args.choices === undefined) {
          return errorResult('Choice questions require "choices".');
        }
        if (args.correctIndex === undefined) {
          return errorResult('Choice questions require "correctIndex".');
        }
        if (args.expectedAnswer !== undefined) {
          return errorResult('Choice questions must not include "expectedAnswer".');
        }
        if (args.acceptableAnswers !== undefined) {
          return errorResult('Choice questions must not include "acceptableAnswers".');
        }
        if (args.gradingNotes !== undefined) {
          return errorResult('Choice questions must not include "gradingNotes".');
        }
        const config = getConfigFn();
        const bounds = config?.choices ?? DEFAULT_TRIVIA_CHOICES;
        if (args.choices.length < bounds.min || args.choices.length > bounds.max) {
          return errorResult(
            `Choice question must have between ${bounds.min} and ${bounds.max} options (got ${args.choices.length}).`,
          );
        }
        if (args.correctIndex < 0 || args.correctIndex >= args.choices.length) {
          return errorResult(
            `correctIndex (${args.correctIndex}) must be in [0, ${args.choices.length}).`,
          );
        }
        for (let i = 0; i < args.choices.length; i++) {
          const trimmed = args.choices[i].trim();
          if (trimmed.length < 1 || trimmed.length > 100) {
            return errorResult(
              `Choice at index ${i} must be 1-100 characters after trim (got ${trimmed.length}).`,
            );
          }
        }
        const normalized = args.choices.map((c) => c.trim().toLowerCase());
        if (new Set(normalized).size !== normalized.length) {
          return errorResult("Choices must be unique (after trimming and case-folding).");
        }
      } else {
        // freeform
        if (args.isTrue !== undefined) {
          return errorResult('Freeform questions must not include "isTrue".');
        }
        if (args.choices !== undefined) {
          return errorResult('Freeform questions must not include "choices".');
        }
        if (args.correctIndex !== undefined) {
          return errorResult('Freeform questions must not include "correctIndex".');
        }
        if (args.expectedAnswer === undefined || args.expectedAnswer.trim().length === 0) {
          return errorResult(
            'Freeform questions require "expectedAnswer" (the canonical correct answer).',
          );
        }
        if (args.expectedAnswer.length > 200) {
          return errorResult(
            `"expectedAnswer" must be at most 200 characters (got ${args.expectedAnswer.length}).`,
          );
        }
        if (args.acceptableAnswers !== undefined) {
          for (let i = 0; i < args.acceptableAnswers.length; i++) {
            const trimmed = args.acceptableAnswers[i].trim();
            if (trimmed.length < 1 || trimmed.length > 200) {
              return errorResult(
                `acceptableAnswers[${i}] must be 1-200 characters after trim (got ${trimmed.length}).`,
              );
            }
          }
        }
        if (args.gradingNotes !== undefined && args.gradingNotes.length > 500) {
          return errorResult(
            `"gradingNotes" must be at most 500 characters (got ${args.gradingNotes.length}).`,
          );
        }
      }

      // Validate topical-vs-fact fields
      if (questionType === "topical") {
        if (args.sourceUrl === undefined || args.sourceUrl.length === 0) {
          return errorResult('Topical questions require "sourceUrl" (an HTTPS citation URL).');
        }
        if (!args.sourceUrl.startsWith("https://")) {
          return errorResult('"sourceUrl" must use https://.');
        }
        // Basic shape: must have a host after the scheme.
        const hostPart = args.sourceUrl.slice("https://".length).split("/")[0];
        if (hostPart.length === 0 || !hostPart.includes(".")) {
          return errorResult('"sourceUrl" must include a valid host.');
        }
      } else {
        if (args.sourceUrl !== undefined) {
          return errorResult('"sourceUrl" is only permitted on topical questions.');
        }
        if (args.eventDate !== undefined) {
          return errorResult('"eventDate" is only permitted on topical questions.');
        }
      }
      if (args.eventDate !== undefined && !ISO_DATE_RE.test(args.eventDate)) {
        return errorResult('"eventDate" must be ISO 8601 calendar date (YYYY-MM-DD).');
      }

      const scoped = data.forGame(args.game);
      const seasonsState = await scoped.loadSeasonsState();
      const currentSeasonEntry = findCurrentSeason(seasonsState, Date.now());
      const seasonFormat = currentSeasonEntry?.format;

      if (seasonFormat !== undefined) {
        if (args.slot === undefined) {
          return errorResult(
            `Season "${currentSeasonEntry?.slug}" has a format with ${seasonFormat.questions.length} slot(s) — save_question requires a slot argument.`,
          );
        }
        if (args.slot.index < 0 || args.slot.index >= seasonFormat.questions.length) {
          return errorResult(
            `slot index ${args.slot.index} out of range — active season "${currentSeasonEntry?.slug}" has ${seasonFormat.questions.length} slot(s).`,
          );
        }
      } else if (args.slot !== undefined) {
        return errorResult(
          "Season has no format — save_question must be called WITHOUT a slot argument.",
        );
      }

      const seasonCategories =
        currentSeasonEntry !== null ? currentSeasonEntry.categories : await data.loadCategories();
      const config = getConfigFn();

      const slotCategories =
        seasonFormat !== undefined && args.slot !== undefined
          ? resolveSlotCategories(seasonFormat.questions[args.slot.index], seasonCategories)
          : seasonCategories;
      const categoryLower = args.category.toLowerCase();
      const matchingCategory = slotCategories.find((c) => c.toLowerCase() === categoryLower);

      if (!matchingCategory) {
        const hint =
          seasonFormat !== undefined && args.slot !== undefined
            ? `Category "${args.category}" is not in slot ${args.slot.index}'s resolved pool (${slotCategories.length} categories). The slot${seasonFormat.questions[args.slot.index].categories !== undefined ? " narrows the season pool" : " inherits the season pool"}.`
            : currentSeasonEntry !== null
              ? `Category "${args.category}" is not in this season's pool. Use add_categories to add it (target: "current" for this season only, or "both" to also persist it in the default baseline).`
              : `Category "${args.category}" not found in the pool. Use add_categories to add it first.`;
        return errorResult(hint);
      }

      const slotIndexForResolution =
        seasonFormat !== undefined && args.slot !== undefined ? args.slot.index : null;

      if (seasonFormat !== undefined && args.slot !== undefined) {
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
        const weightForQuestionType =
          questionType === "fact" ? slotQuestionTypeWeights.fact : slotQuestionTypeWeights.topical;
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
        seasonFormat !== undefined && args.slot !== undefined
          ? {
              index: args.slot.index,
              ...(seasonFormat.questions[args.slot.index].label !== undefined
                ? { label: seasonFormat.questions[args.slot.index].label as string }
                : {}),
            }
          : null;
      const base: TriviaQuestion = {
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
        ...(args.sourceUrl !== undefined ? { sourceUrl: args.sourceUrl } : {}),
        ...(args.eventDate !== undefined ? { eventDate: args.eventDate } : {}),
      };

      const question: TriviaQuestion =
        answersFormat === "boolean"
          ? { ...base, isTrue: args.isTrue }
          : answersFormat === "choice"
            ? { ...base, choices: args.choices, correctIndex: args.correctIndex }
            : {
                ...base,
                expectedAnswer: args.expectedAnswer ?? "",
                ...(args.acceptableAnswers !== undefined
                  ? { acceptableAnswers: args.acceptableAnswers }
                  : {}),
                ...(args.gradingNotes !== undefined ? { gradingNotes: args.gradingNotes } : {}),
              };

      await scoped.saveQuestion(question);

      return textResult({ saved: true, question });
    },
  );
}

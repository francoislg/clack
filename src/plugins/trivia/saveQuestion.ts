import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { getConfig, type Config, DEFAULT_TRIVIA_CHOICES } from "../../config.js";
import { findCurrentSeason } from "./data.js";
import type { TriviaDataLayer, TriviaQuestion } from "./types.js";

const DESCRIPTION = `Save a new trivia question.

Two shapes are accepted, determined by \`type\`:

BOOLEAN (default — \`type: "boolean"\` or absent):
- Required: \`category\`, \`statement\`, \`isTrue\`, \`emojis\`.
- The stored record carries \`type: "boolean"\` and \`isTrue\`; no \`choices\`/\`correctIndex\`.

CHOICE (\`type: "choice"\`):
- Required: \`category\`, \`statement\`, \`emojis\`, \`choices\` (string[], length within active [min, max]), \`correctIndex\` (0-based).
- The stored record carries \`type: "choice"\`, \`choices\`, and \`correctIndex\`; no \`isTrue\`.
- Exactly ONE correct answer per question — validated at this tool's boundary.

Validation rejects: out-of-range correctIndex; duplicate or whitespace/case-equivalent choices; choices outside the configured \`trivia.choices.{min, max}\` bounds; choice strings outside 1–100 chars after trim; passing \`isTrue\` with type "choice" or \`choices\`/\`correctIndex\` with type "boolean".`;

export function createSaveQuestionTool(
  data: TriviaDataLayer,
  getConfigFn: () => Config | null = () => {
    try {
      return getConfig();
    } catch {
      return null;
    }
  },
) {
  return tool(
    "save_question",
    DESCRIPTION,
    {
      type: z
        .enum(["boolean", "choice"])
        .optional()
        .describe('Question shape: "boolean" (default) or "choice".'),
      category: z.string().describe("The category from the pool (must exist)"),
      statement: z.string().describe("The trivia statement"),
      isTrue: z
        .boolean()
        .optional()
        .describe("REQUIRED for boolean questions. MUST NOT be set for choice questions."),
      choices: z
        .array(z.string())
        .optional()
        .describe(
          "REQUIRED for choice questions (length within active [min, max]). MUST NOT be set for boolean questions.",
        ),
      correctIndex: z
        .number()
        .int()
        .optional()
        .describe(
          "REQUIRED for choice questions (0-based, in [0, choices.length)). MUST NOT be set for boolean questions.",
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
    },
    async (args) => {
      if (args.statement.length < 10) {
        return errorResult("Statement must be at least 10 characters");
      }
      if (args.statement.length > 500) {
        return errorResult("Statement must be at most 500 characters");
      }
      if (args.emojis.length < 1 || args.emojis.length > 4) {
        return errorResult("Must provide 1-4 emojis");
      }

      const type = args.type ?? "boolean";

      if (type === "boolean") {
        if (args.isTrue === undefined) {
          return errorResult('Boolean questions require "isTrue".');
        }
        if (args.choices !== undefined) {
          return errorResult('Boolean questions must not include "choices".');
        }
        if (args.correctIndex !== undefined) {
          return errorResult('Boolean questions must not include "correctIndex".');
        }
      } else {
        if (args.isTrue !== undefined) {
          return errorResult('Choice questions must not include "isTrue".');
        }
        if (args.choices === undefined) {
          return errorResult('Choice questions require "choices".');
        }
        if (args.correctIndex === undefined) {
          return errorResult('Choice questions require "correctIndex".');
        }
        const config = getConfigFn();
        const bounds = config?.trivia?.choices ?? DEFAULT_TRIVIA_CHOICES;
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
      }

      const seasonsState = await data.loadSeasonsState();
      const currentSeasonEntry = findCurrentSeason(seasonsState, Date.now());
      const categories =
        currentSeasonEntry !== null ? currentSeasonEntry.categories : await data.loadCategories();
      const categoryLower = args.category.toLowerCase();
      const matchingCategory = categories.find((c) => c.toLowerCase() === categoryLower);

      if (!matchingCategory) {
        const hint =
          currentSeasonEntry !== null
            ? `Category "${args.category}" is not in this season's pool. Use add_categories to add it (target: "current" for this season only, or "both" to also persist it in the default baseline).`
            : `Category "${args.category}" not found in the pool. Use add_categories to add it first.`;
        return errorResult(hint);
      }

      const currentSeasonSlug = currentSeasonEntry?.slug ?? null;
      const base: TriviaQuestion = {
        id: randomUUID(),
        category: matchingCategory,
        statement: args.statement,
        type,
        emojis: args.emojis,
        createdAt: Date.now(),
        ...(currentSeasonSlug !== null ? { season: currentSeasonSlug } : {}),
        ...(args.suggestedDifficulty !== undefined
          ? { suggestedDifficulty: args.suggestedDifficulty }
          : {}),
        ...(args.difficulty !== undefined ? { difficulty: args.difficulty } : {}),
      };

      const question: TriviaQuestion =
        type === "boolean"
          ? { ...base, isTrue: args.isTrue }
          : { ...base, choices: args.choices, correctIndex: args.correctIndex };

      await data.saveQuestion(question);

      return textResult({ saved: true, question });
    },
  );
}

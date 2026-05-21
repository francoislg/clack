import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { findSeasonBySlug, validateNoOverlap } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import {
  validateAnswersFormat,
  validateQuestionType,
  validateContexts,
  validateFormat,
} from "../../domain/seasonFormat.js";
import type { TriviaDataLayer, SeasonsState, SeasonEntry, SeasonFormat } from "../../core/types.js";
import type {
  TriviaAnswersFormatWeights,
  TriviaQuestionTypeWeights,
  TriviaContextEntry,
} from "../../../../config.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeTheme(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "theme must be non-empty (pass null to clear)." };
  }
  return { ok: true, value: trimmed };
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

const contextEntryShape = z.object({
  name: z.string(),
  weight: z.number().positive().optional(),
});

const slotShape = z.object({
  label: z.string().optional(),
  categories: z.array(z.string()).optional(),
  answersFormat: z
    .object({
      boolean: z.number().int().nonnegative().optional(),
      choice: z.number().int().nonnegative().optional(),
      freeform: z.number().int().nonnegative().optional(),
    })
    .optional(),
  questionType: z
    .object({
      fact: z.number().int().nonnegative().optional(),
      topical: z.number().int().nonnegative().optional(),
    })
    .optional(),
  contexts: z.array(contextEntryShape).optional(),
});

export function createUpsertSeasonTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "upsert_season",
    "Create a new trivia season or update an existing one (identified by slug) within a specific game. Slug is immutable — to rename, delete + upsert. Validates no overlap within this game's timeline. On CREATE: requires startedAt + expectedEndAt. If `categories` is provided (and non-empty), the new season's pool is EXACTLY that list — use this for themed seasons. If `categories` is omitted or empty, the new season's pool is copied from the global categories.json. On UPDATE: applies omit-to-keep semantics; cannot mutate startedAt of an already-started season; `categories` is ignored on UPDATE — use add_categories/remove_categories with target slug to refine. `theme`, `answersFormat`, `questionType`, and `contexts` all accept `null` on UPDATE to clear the field. `theme` is a short human-readable narrative label (e.g. \"Halloween Spooktacular\") surfaced at the top of the season's first question post. Use endedAt to mark a season as closed.",
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). The season operation targets this game's seasons.json.",
        ),
      slug: z
        .string()
        .describe(
          "Non-empty kebab-case identifier. Treated as immutable key (no rename via this tool). Unique within this game's timeline.",
        ),
      startedAt: z.number().optional().describe("Unix-ms when the season's active window begins."),
      expectedEndAt: z
        .number()
        .optional()
        .describe("Unix-ms when the season's active window is expected to close."),
      endedAt: z
        .number()
        .optional()
        .describe("Unix-ms when the season was actually closed. Set this to mark a season ended."),
      categories: z
        .array(z.string())
        .optional()
        .describe(
          "Season's category pool. Provided AND non-empty → the season uses EXACTLY this list. Omitted OR empty → copies from the global categories.json. Used only on CREATE.",
        ),
      theme: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Optional short human-readable narrative label (e.g. "Halloween Spooktacular") surfaced at the top of the season\'s first question post. On UPDATE: passing `null` clears the field; omitting preserves the existing value. Empty / whitespace-only strings are rejected.',
        ),
      answersFormat: z
        .object({
          boolean: z.number().int().nonnegative().optional(),
          choice: z.number().int().nonnegative().optional(),
          freeform: z.number().int().nonnegative().optional(),
        })
        .nullable()
        .optional()
        .describe(
          "Optional per-season answer-format weights (boolean/choice/freeform). On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      questionType: z
        .object({
          fact: z.number().int().nonnegative().optional(),
          topical: z.number().int().nonnegative().optional(),
        })
        .nullable()
        .optional()
        .describe(
          "Optional per-season fact-vs-topical weights. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      contexts: z
        .array(contextEntryShape)
        .nullable()
        .optional()
        .describe(
          "Optional per-season lens list (e.g. Quebec, International, academic). On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      format: z
        .object({
          questions: z
            .array(slotShape)
            .describe(
              "Ordered list of question slots posted per question-cron fire (one item per slot).",
            ),
        })
        .nullable()
        .optional()
        .describe(
          "Optional per-season question composition. When set, each question-cron fire posts `format.questions.length` questions in slot order. Each slot may narrow `label` / `categories` / `answersFormat` / `questionType` / `contexts`; missing fields cascade to the season's defaults. On UPDATE: object value replaces the whole format; explicit `null` clears the field; mid-season mutation permitted.",
        ),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      if (!SLUG_RE.test(args.slug)) {
        return errorResult(
          `Invalid slug "${args.slug}": must be non-empty kebab-case (lowercase letters/digits, segments separated by single hyphens).`,
        );
      }

      const scoped = data.forGame(args.game);
      const state = (await scoped.loadSeasonsState()) ?? { seasons: [] };
      const existing = findSeasonBySlug(state, args.slug);

      if (existing === null) {
        // CREATE branch
        if (args.startedAt === undefined || args.expectedEndAt === undefined) {
          return errorResult("Creating a new season requires both startedAt and expectedEndAt.");
        }
        if (args.startedAt >= args.expectedEndAt) {
          return errorResult(
            `startedAt (${args.startedAt}) must be strictly less than expectedEndAt (${args.expectedEndAt}).`,
          );
        }
        if (args.endedAt !== undefined && args.endedAt <= args.startedAt) {
          return errorResult(
            `endedAt (${args.endedAt}) must be strictly greater than startedAt (${args.startedAt}).`,
          );
        }

        const providedCategories = (args.categories ?? []).filter((c) => c.length > 0);
        const categories =
          providedCategories.length > 0
            ? dedupePreservingOrder(providedCategories)
            : [...(await data.loadCategories())];
        if (categories.length === 0) {
          return errorResult(
            "Cannot create a season with zero categories. Add at least one entry to categories.json or pass a non-empty `categories` array.",
          );
        }

        let answersFormatWeights: TriviaAnswersFormatWeights | undefined;
        if (args.answersFormat !== undefined && args.answersFormat !== null) {
          const sparse: Record<string, number> = {};
          if (args.answersFormat.boolean !== undefined) sparse.boolean = args.answersFormat.boolean;
          if (args.answersFormat.choice !== undefined) sparse.choice = args.answersFormat.choice;
          const validated = validateAnswersFormat(sparse);
          if (!validated.ok) return errorResult(validated.error);
          answersFormatWeights = validated.value;
        }

        let questionTypeWeights: TriviaQuestionTypeWeights | undefined;
        if (args.questionType !== undefined && args.questionType !== null) {
          const sparse: Record<string, number> = {};
          if (args.questionType.fact !== undefined) sparse.fact = args.questionType.fact;
          if (args.questionType.topical !== undefined) sparse.topical = args.questionType.topical;
          const validated = validateQuestionType(sparse);
          if (!validated.ok) return errorResult(validated.error);
          questionTypeWeights = validated.value;
        }

        let contexts: TriviaContextEntry[] | undefined;
        if (args.contexts !== undefined && args.contexts !== null) {
          const validated = validateContexts(args.contexts);
          if (!validated.ok) return errorResult(validated.error);
          contexts = validated.value;
        }

        let format: SeasonFormat | undefined;
        if (args.format !== undefined && args.format !== null) {
          const validated = validateFormat(args.format);
          if (!validated.ok) return errorResult(validated.error);
          format = validated.value;
        }

        let theme: string | undefined;
        if (args.theme !== undefined && args.theme !== null) {
          const normalized = normalizeTheme(args.theme);
          if (!normalized.ok) return errorResult(normalized.error);
          theme = normalized.value;
        }

        const entry: SeasonEntry = {
          slug: args.slug,
          startedAt: args.startedAt,
          expectedEndAt: args.expectedEndAt,
          ...(args.endedAt !== undefined ? { endedAt: args.endedAt } : {}),
          ...(theme !== undefined ? { theme } : {}),
          categories,
          ...(answersFormatWeights !== undefined ? { answersFormat: answersFormatWeights } : {}),
          ...(questionTypeWeights !== undefined ? { questionType: questionTypeWeights } : {}),
          ...(contexts !== undefined ? { contexts } : {}),
          ...(format !== undefined ? { format } : {}),
        };

        try {
          validateNoOverlap(state, entry);
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }

        const next: SeasonsState = { seasons: [...state.seasons, entry] };
        await scoped.saveSeasonsState(next);

        return textResult({
          game: args.game,
          slug: entry.slug,
          action: "created",
          startedAt: entry.startedAt,
          expectedEndAt: entry.expectedEndAt,
          endedAt: entry.endedAt ?? null,
          categoriesCount: entry.categories.length,
          hasTheme: entry.theme !== undefined,
          hasAnswersFormat: entry.answersFormat !== undefined,
          hasQuestionType: entry.questionType !== undefined,
          hasContexts: entry.contexts !== undefined,
          hasFormat: entry.format !== undefined,
          slotCount: entry.format?.questions.length ?? 0,
        });
      }

      // UPDATE branch
      const now = Date.now();
      if (args.startedAt !== undefined && args.startedAt !== existing.startedAt) {
        if (existing.startedAt <= now) {
          return errorResult(
            `Cannot shift startedAt of an already-started season "${args.slug}". The past is immutable; edit seasons.json directly for emergency corrections.`,
          );
        }
      }

      let updatedAnswersFormat: TriviaAnswersFormatWeights | undefined = existing.answersFormat;
      if (args.answersFormat === null) {
        updatedAnswersFormat = undefined;
      } else if (args.answersFormat !== undefined) {
        const sparse: Record<string, number> = {};
        if (args.answersFormat.boolean !== undefined) sparse.boolean = args.answersFormat.boolean;
        if (args.answersFormat.choice !== undefined) sparse.choice = args.answersFormat.choice;
        const validated = validateAnswersFormat(sparse);
        if (!validated.ok) return errorResult(validated.error);
        updatedAnswersFormat = validated.value;
      }

      let updatedQuestionType: TriviaQuestionTypeWeights | undefined = existing.questionType;
      if (args.questionType === null) {
        updatedQuestionType = undefined;
      } else if (args.questionType !== undefined) {
        const sparse: Record<string, number> = {};
        if (args.questionType.fact !== undefined) sparse.fact = args.questionType.fact;
        if (args.questionType.topical !== undefined) sparse.topical = args.questionType.topical;
        const validated = validateQuestionType(sparse);
        if (!validated.ok) return errorResult(validated.error);
        updatedQuestionType = validated.value;
      }

      let updatedContexts: TriviaContextEntry[] | undefined = existing.contexts;
      if (args.contexts === null) {
        updatedContexts = undefined;
      } else if (args.contexts !== undefined) {
        const validated = validateContexts(args.contexts);
        if (!validated.ok) return errorResult(validated.error);
        updatedContexts = validated.value;
      }

      let updatedFormat: SeasonFormat | undefined = existing.format;
      if (args.format === null) {
        updatedFormat = undefined;
      } else if (args.format !== undefined) {
        const validated = validateFormat(args.format);
        if (!validated.ok) return errorResult(validated.error);
        updatedFormat = validated.value;
      }

      let updatedTheme: string | undefined = existing.theme;
      if (args.theme === null) {
        updatedTheme = undefined;
      } else if (args.theme !== undefined) {
        const normalized = normalizeTheme(args.theme);
        if (!normalized.ok) return errorResult(normalized.error);
        updatedTheme = normalized.value;
      }

      const updated: SeasonEntry = {
        slug: existing.slug,
        startedAt: args.startedAt ?? existing.startedAt,
        expectedEndAt: args.expectedEndAt ?? existing.expectedEndAt,
        ...(args.endedAt !== undefined
          ? { endedAt: args.endedAt }
          : existing.endedAt !== undefined
            ? { endedAt: existing.endedAt }
            : {}),
        ...(updatedTheme !== undefined ? { theme: updatedTheme } : {}),
        categories: existing.categories,
        ...(updatedAnswersFormat !== undefined ? { answersFormat: updatedAnswersFormat } : {}),
        ...(updatedQuestionType !== undefined ? { questionType: updatedQuestionType } : {}),
        ...(updatedContexts !== undefined ? { contexts: updatedContexts } : {}),
        ...(updatedFormat !== undefined ? { format: updatedFormat } : {}),
      };

      const effectiveEnd = updated.endedAt ?? updated.expectedEndAt;
      if (updated.startedAt >= effectiveEnd) {
        return errorResult(
          `After update, startedAt (${updated.startedAt}) is no longer strictly less than (endedAt ?? expectedEndAt) (${effectiveEnd}).`,
        );
      }

      if (updated.categories.length === 0) {
        return errorResult(
          `Season "${args.slug}" would have zero categories after update — rejected.`,
        );
      }

      try {
        validateNoOverlap(state, updated, args.slug);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const nextSeasons = state.seasons.map((s) => (s.slug === args.slug ? updated : s));
      await scoped.saveSeasonsState({ seasons: nextSeasons });

      return textResult({
        game: args.game,
        slug: updated.slug,
        action: "updated",
        startedAt: updated.startedAt,
        expectedEndAt: updated.expectedEndAt,
        endedAt: updated.endedAt ?? null,
        categoriesCount: updated.categories.length,
        hasTheme: updated.theme !== undefined,
        hasAnswersFormat: updated.answersFormat !== undefined,
        hasQuestionType: updated.questionType !== undefined,
        hasContexts: updated.contexts !== undefined,
        hasFormat: updated.format !== undefined,
        slotCount: updated.format?.questions.length ?? 0,
      });
    },
  );
}

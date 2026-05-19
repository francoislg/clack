import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { findSeasonBySlug, validateNoOverlap } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { validateQuestionTypes, validateFormat } from "../../domain/seasonFormat.js";
import type {
  TriviaDataLayer,
  SeasonsState,
  SeasonEntry,
  SeasonQuestionTypeWeights,
  SeasonFormat,
} from "../../core/types.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

export function createUpsertSeasonTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "upsert_season",
    "Create a new trivia season or update an existing one (identified by slug) within a specific game. Slug is immutable — to rename, delete + upsert. Validates no overlap within this game's timeline. On CREATE: requires startedAt + expectedEndAt. If `categories` is provided (and non-empty), the new season's pool is EXACTLY that list — use this for themed seasons. If `categories` is omitted or empty, the new season's pool is copied from the global categories.json (the persistent baseline). On UPDATE: applies omit-to-keep semantics; cannot mutate startedAt of an already-started season; `categories` is ignored on UPDATE — use add_categories/remove_categories with target slug to refine. Use endedAt to mark a season as closed.",
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
      questionTypes: z
        .object({
          boolean: z.number().int().nonnegative().optional(),
          choice: z.number().int().nonnegative().optional(),
        })
        .nullable()
        .optional()
        .describe(
          "Optional per-season question-type weights. On UPDATE: passing `null` clears the field. Mid-season mutation is permitted.",
        ),
      format: z
        .object({
          questions: z
            .array(
              z.object({
                label: z.string().optional(),
                categories: z.array(z.string()).optional(),
                questionTypes: z
                  .object({
                    boolean: z.number().int().nonnegative().optional(),
                    choice: z.number().int().nonnegative().optional(),
                  })
                  .optional(),
              }),
            )
            .describe(
              "Ordered list of question slots posted per question-cron fire (one item per slot).",
            ),
        })
        .nullable()
        .optional()
        .describe(
          "Optional per-season question composition. When set, each question-cron fire posts `format.questions.length` questions in slot order. Each slot may narrow `label` / `categories` / `questionTypes`; missing fields cascade to the season's defaults. On UPDATE: object value replaces the whole format; explicit `null` clears the field; mid-season mutation is permitted.",
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

        let questionTypes: SeasonQuestionTypeWeights | undefined;
        if (args.questionTypes !== undefined && args.questionTypes !== null) {
          const sparse: Record<string, number> = {};
          if (args.questionTypes.boolean !== undefined) sparse.boolean = args.questionTypes.boolean;
          if (args.questionTypes.choice !== undefined) sparse.choice = args.questionTypes.choice;
          const validated = validateQuestionTypes(sparse);
          if (!validated.ok) return errorResult(validated.error);
          questionTypes = validated.value;
        }

        let format: SeasonFormat | undefined;
        if (args.format !== undefined && args.format !== null) {
          const validated = validateFormat(args.format);
          if (!validated.ok) return errorResult(validated.error);
          format = validated.value;
        }

        const entry: SeasonEntry = {
          slug: args.slug,
          startedAt: args.startedAt,
          expectedEndAt: args.expectedEndAt,
          ...(args.endedAt !== undefined ? { endedAt: args.endedAt } : {}),
          categories,
          ...(questionTypes !== undefined ? { questionTypes } : {}),
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
          hasQuestionTypes: entry.questionTypes !== undefined,
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

      let updatedQuestionTypes: SeasonQuestionTypeWeights | undefined = existing.questionTypes;
      if (args.questionTypes === null) {
        updatedQuestionTypes = undefined;
      } else if (args.questionTypes !== undefined) {
        const sparse: Record<string, number> = {};
        if (args.questionTypes.boolean !== undefined) sparse.boolean = args.questionTypes.boolean;
        if (args.questionTypes.choice !== undefined) sparse.choice = args.questionTypes.choice;
        const validated = validateQuestionTypes(sparse);
        if (!validated.ok) return errorResult(validated.error);
        updatedQuestionTypes = validated.value;
      }

      let updatedFormat: SeasonFormat | undefined = existing.format;
      if (args.format === null) {
        updatedFormat = undefined;
      } else if (args.format !== undefined) {
        const validated = validateFormat(args.format);
        if (!validated.ok) return errorResult(validated.error);
        updatedFormat = validated.value;
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
        categories: existing.categories,
        ...(updatedQuestionTypes !== undefined ? { questionTypes: updatedQuestionTypes } : {}),
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
        hasQuestionTypes: updated.questionTypes !== undefined,
        hasFormat: updated.format !== undefined,
        slotCount: updated.format?.questions.length ?? 0,
      });
    },
  );
}

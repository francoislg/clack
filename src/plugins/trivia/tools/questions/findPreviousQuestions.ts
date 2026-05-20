import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";

// Sentinel for "filter to a slug that can't match any record"; used when season:"current" is
// requested during a timeline gap (current season doesn't exist, so the result must be empty).
const NO_MATCH_SENTINEL = "__no_match_sentinel__";

// The response intentionally omits the answer-key fields (`isTrue` for boolean
// questions, `correctIndex` for choice questions) — the answer key is not
// search-safe and is reachable only via the admin-tier `get_question_history` tool.
// For choice questions, `choices` is included (the option strings themselves are
// not the answer key — only the `correctIndex` is).
type SearchResultQuestion = Pick<
  TriviaQuestion,
  | "id"
  | "answersFormat"
  | "questionType"
  | "category"
  | "statement"
  | "choices"
  | "emojis"
  | "createdAt"
  | "postedAt"
  | "messageLink"
  | "processedAt"
  | "season"
  | "slot"
  | "suggestedDifficulty"
  | "difficulty"
  | "context"
  | "sourceUrl"
  | "eventDate"
>;

function toSearchResult(q: TriviaQuestion): SearchResultQuestion {
  const result: SearchResultQuestion = {
    id: q.id,
    category: q.category,
    statement: q.statement,
    emojis: q.emojis,
    createdAt: q.createdAt,
  };
  if (q.answersFormat !== undefined) result.answersFormat = q.answersFormat;
  if (q.questionType !== undefined) result.questionType = q.questionType;
  if (q.choices !== undefined) result.choices = q.choices;
  if (q.postedAt !== undefined) result.postedAt = q.postedAt;
  if (q.messageLink !== undefined) result.messageLink = q.messageLink;
  if (q.processedAt !== undefined) result.processedAt = q.processedAt;
  if (q.season !== undefined) result.season = q.season;
  if (q.slot !== undefined) result.slot = q.slot;
  if (q.suggestedDifficulty !== undefined) result.suggestedDifficulty = q.suggestedDifficulty;
  if (q.difficulty !== undefined) result.difficulty = q.difficulty;
  if (q.context !== undefined) result.context = q.context;
  if (q.sourceUrl !== undefined) result.sourceUrl = q.sourceUrl;
  if (q.eventDate !== undefined) result.eventDate = q.eventDate;
  return result;
}

export function createFindPreviousQuestionsTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "find_previous_questions",
    "Search past trivia questions by category and/or statement text to check what has been asked before. Defaults to searching across all seasons. Pass `recentBatchFromNow: N` to fetch the Nth most recently posted batch as of now (1 = latest, 2 = the one before that, etc.).",
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). Search is scoped to this game's questions only.",
        ),
      category: z
        .string()
        .optional()
        .describe("Filter by category (exact match, case-insensitive)"),
      text: z
        .string()
        .optional()
        .describe("Search in statement text (case-insensitive substring match)"),
      season: z
        .string()
        .optional()
        .describe(
          'Season filter: "all" (default — scans every season, the right choice for duplicate detection), "current" (scopes to the active season), or any historical season slug.',
        ),
      recentBatchFromNow: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Select the Nth most recently posted batch AS OF THE CURRENT MOMENT. 1 = the latest batch, 2 = the one before that, and so on. Ranks batches by their max(postedAt) anchored to NOW — this is NOT a season-relative position and NOT an absolute index. Other filters (category, text, season) are applied to the question pool BEFORE grouping; the selected batch is then returned in full (capped by limit). Legacy questions with no batchId are excluded from this view.",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of questions to return (default 20, most recent first)"),
    },
    async (args) => {
      try {
        requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const limit = args.limit ?? 20;
      const questions = await scoped.loadQuestions();

      const seasonsState = await scoped.loadSeasonsState();
      const seasonsEnabled = seasonsState !== null;
      const currentSeason = findCurrentSeason(seasonsState, Date.now());
      const seasonArg = args.season ?? "all";
      const seasonFilter: string | null =
        !seasonsEnabled || seasonArg === "all"
          ? null
          : seasonArg === "current"
            ? (currentSeason?.slug ?? NO_MATCH_SENTINEL)
            : seasonArg;

      const filtered = questions.filter((q) => {
        if (args.category && q.category.toLowerCase() !== args.category.toLowerCase()) return false;
        if (args.text && !q.statement.toLowerCase().includes(args.text.toLowerCase())) return false;
        if (seasonFilter !== null && q.season !== seasonFilter) return false;
        return true;
      });

      if (args.recentBatchFromNow !== undefined) {
        const batched = filtered.filter((q) => q.postedAt !== undefined && q.batchId !== undefined);
        const groups = new Map<string, TriviaQuestion[]>();
        for (const q of batched) {
          const key = q.batchId as string;
          const bucket = groups.get(key);
          if (bucket) bucket.push(q);
          else groups.set(key, [q]);
        }
        const ranked = [...groups.entries()]
          .map(([batchId, items]) => ({
            batchId,
            items,
            maxPostedAt: Math.max(...items.map((q) => q.postedAt as number)),
          }))
          .sort((a, b) => {
            if (b.maxPostedAt !== a.maxPostedAt) return b.maxPostedAt - a.maxPostedAt;
            return a.batchId.localeCompare(b.batchId);
          });

        const selected = ranked[args.recentBatchFromNow - 1];
        if (!selected) {
          return textResult({ questions: [], count: 0, total: 0 });
        }

        const batchQuestions = [...selected.items]
          .sort((a, b) => (a.postedAt as number) - (b.postedAt as number))
          .slice(0, limit)
          .map(toSearchResult);

        return textResult({
          questions: batchQuestions,
          count: batchQuestions.length,
          total: selected.items.length,
        });
      }

      const sorted = filtered
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map(toSearchResult);

      return textResult({ questions: sorted, count: sorted.length, total: filtered.length });
    },
  );
}

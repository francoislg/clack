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
  | "type"
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
>;

function toSearchResult(q: TriviaQuestion): SearchResultQuestion {
  const result: SearchResultQuestion = {
    id: q.id,
    category: q.category,
    statement: q.statement,
    emojis: q.emojis,
    createdAt: q.createdAt,
  };
  if (q.type !== undefined) result.type = q.type;
  if (q.choices !== undefined) result.choices = q.choices;
  if (q.postedAt !== undefined) result.postedAt = q.postedAt;
  if (q.messageLink !== undefined) result.messageLink = q.messageLink;
  if (q.processedAt !== undefined) result.processedAt = q.processedAt;
  if (q.season !== undefined) result.season = q.season;
  if (q.slot !== undefined) result.slot = q.slot;
  if (q.suggestedDifficulty !== undefined) result.suggestedDifficulty = q.suggestedDifficulty;
  if (q.difficulty !== undefined) result.difficulty = q.difficulty;
  return result;
}

export function createFindPreviousQuestionsTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "find_previous_questions",
    "Search past trivia questions by category and/or statement text to check what has been asked before. Defaults to searching across all seasons.",
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

      const sorted = filtered
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map(toSearchResult);

      return textResult({ questions: sorted, count: sorted.length, total: filtered.length });
    },
  );
}

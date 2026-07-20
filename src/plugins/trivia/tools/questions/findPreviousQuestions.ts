import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { getAnswerTypeHandler } from "../../answerTypes/registry.js";
import type { JsonValue } from "../../core/configTypes.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { UnknownGameError } from "../../core/gamesRegistry.js";
import type {
  TriviaDataLayer,
  TriviaQuestion,
  QuestionOverrideOriginals,
} from "../../core/types.js";
import { mediaToJson } from "../../domain/mediaJson.js";
import { blocksToJson } from "../../domain/blocksToJson.js";

const CURRENT_SEASON_TOKEN = "current";

type QuestionWithGame = TriviaQuestion & { __game: string };

/**
 * Lowercased text a keyword is matched against: the `statement`, the image
 * `media` text when present (orthogonal to `answersFormat`, so assembled here
 * rather than on the handler), and the row's answer-type-specific text from the
 * handler (choice options, freeform answer fields). Searched only — these fields
 * are never surfaced in the response (see `toSearchResult` / `buildSearchResult`).
 */
function keywordHaystackFor(q: TriviaQuestion): string[] {
  const parts = [q.statement];
  if (q.promptMedium === "image" && q.media !== undefined) {
    parts.push(q.media.title, q.media.altText);
  }
  parts.push(...getAnswerTypeHandler(q.answersFormat).keywordHaystack(q));
  return parts.map((s) => s.toLowerCase());
}

/**
 * Pre-override values captured by `override_question`, as a plain JSON object.
 * `difficulty: null` is meaningful — it records a question that was never rated,
 * as distinct from one whose original rating is simply not captured yet.
 */
function originalsToJson(originals: QuestionOverrideOriginals): JsonValue {
  const out: Record<string, JsonValue> = {};
  if (originals.points !== undefined) out.points = originals.points;
  if (originals.difficulty !== undefined) out.difficulty = originals.difficulty;
  return out;
}

function toSearchResult(
  q: QuestionWithGame,
  matchedKeywords: string[] | null,
  includeRevealBlocks: boolean,
  batchFact: { batchPending: boolean; batchIsLatest: boolean } | undefined,
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {
    id: q.id,
    game: q.__game,
    category: q.category,
    statement: q.statement,
    emojis: q.emojis,
    createdAt: q.createdAt,
  };
  // Derived batch facts (posted rows only) — never the raw batchId.
  if (batchFact !== undefined) {
    result.batchPending = batchFact.batchPending;
    result.batchIsLatest = batchFact.batchIsLatest;
  }
  if (q.answersFormat !== undefined) result.answersFormat = q.answersFormat;
  if (q.questionType !== undefined) result.questionType = q.questionType;
  if (q.promptMedium !== undefined) result.promptMedium = q.promptMedium;
  if (q.media !== undefined) result.media = mediaToJson(q.media);
  if (q.postedAt !== undefined) result.postedAt = q.postedAt;
  if (q.messageLink !== undefined) result.messageLink = q.messageLink;
  if (q.processedAt !== undefined) result.processedAt = q.processedAt;
  if (q.season !== undefined) result.season = q.season;
  if (q.slot !== undefined) result.slot = q.slot;
  if (q.suggestedDifficulty !== undefined) result.suggestedDifficulty = q.suggestedDifficulty;
  if (q.difficulty !== undefined) result.difficulty = q.difficulty;
  // Absence reads as 1, so only a weighted question carries the field.
  if (q.points !== undefined) result.points = q.points;
  if (q.overriddenFrom !== undefined) result.overriddenFrom = originalsToJson(q.overriddenFrom);
  if (q.context !== undefined) result.context = q.context;
  if (q.judgeLeniency !== undefined) result.judgeLeniency = q.judgeLeniency;
  if (q.sourceUrl !== undefined) result.sourceUrl = q.sourceUrl;
  if (q.eventDate !== undefined) result.eventDate = q.eventDate;
  if (matchedKeywords !== null) result.matchedKeywords = matchedKeywords;
  // `revealBlocks` reveals the answer, so it surfaces only on opt-in AND only for
  // already-revealed questions (`processedAt` set) — never for live ones.
  if (includeRevealBlocks && q.processedAt !== undefined && q.revealBlocks !== undefined) {
    result.revealBlocks = blocksToJson(q.revealBlocks);
  }
  const handler = getAnswerTypeHandler(q.answersFormat);
  return { ...result, ...handler.buildSearchResult(q) };
}

export function createFindPreviousQuestionsTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "find_previous_questions",
    [
      "Search past or staged trivia questions across one or more games by combining array-shaped criteria with a top-level `match` combinator.",
      "",
      'Each non-empty array criterion (`games`, `categories`, `seasons`, `keywords`) is OR-internal — a row matches the criterion if ANY entry hits. The scalar `posted` criterion, when supplied, filters on the question\'s posted state. `match` (default `"all"`) combines criteria across the top level: `"all"` requires every supplied criterion to be true; `"any"` requires at least one. Omitted or empty arrays are ignored.',
      "",
      "When `games` is omitted, the scan spans every registered game; per-row responses carry `game` so you can see provenance. When `keywords` is supplied, per-row responses include `matchedKeywords` (the subset of input keywords that hit each row's statement).",
      "",
      "Each POSTED row carries two derived batch facts (the internal batch id itself is never returned): `batchPending` — true when the row's batch is unrevealed (still live, votes open); and `batchIsLatest` — true when the row's batch is its game's most-recently-posted. Use these to reason about replay/top-up eligibility and to find the live round's questions to repaint, without ever handling a batch id.",
      "",
      "Three primary use cases:",
      '- DUPLICATE DETECTION during question generation: prefer `match: "any"` with 3-5 distinctive keywords (names, numbers, rare nouns) and omit `games`.',
      '- RECENT BATCH LOOKUP for admin audits (e.g. "last batch\'s difficulty"): pass `games: ["<name>"]` with `recentBatchFromNow: N` (requires exactly one game; requires posted questions).',
      '- STAGED POOL QUERY: pass `posted: false` to scan questions that have been generated and saved but not yet posted to Slack. Typical use: PREP runs check which slots still need filling; POST runs pick the oldest staged question per slot. Pair with `seasons: ["current"]` to scope to the active season. `posted: false` may NOT be combined with `recentBatchFromNow`.',
    ].join("\n"),
    {
      games: z
        .array(z.string())
        .optional()
        .describe(
          "Optional array of game names (each must appear in config.trivia.games[]). When omitted or empty, the scan spans every registered game. Within the array, semantics are OR — a row matches if its source game is any of the listed names.",
        ),
      categories: z
        .array(z.string())
        .optional()
        .describe(
          "Optional array of category names (case-insensitive exact match per entry). OR-internal.",
        ),
      seasons: z
        .array(z.string())
        .optional()
        .describe(
          'Optional array of season slugs. The literal "current" resolves per-game via the game\'s current season. OR-internal. Silently ignored when trivia.seasons.enabled is false.',
        ),
      keywords: z
        .array(z.string())
        .optional()
        .describe(
          "Optional array of keywords. Each entry is matched as a lowercased substring against the row's search haystack: its statement, its image media title/altText (image-medium rows only), its choice option strings (choice rows), and its expected/acceptable/grading answer text (freeform rows). The answer fields are searched but never returned. The row's `category` is NOT part of the haystack — filter on it via `categories`. OR-internal. When non-empty, returned rows carry `matchedKeywords` showing which input keywords hit.",
        ),
      posted: z
        .boolean()
        .optional()
        .describe(
          'Optional boolean criterion on the question\'s posted state. `true` = only rows with `postedAt !== undefined` (already posted to Slack). `false` = only rows with `postedAt === undefined` (staged questions — generated but not yet posted). When omitted, the criterion is not supplied and does NOT participate in the combinator. Typical staged-pool query: `{ games: ["<game>"], seasons: ["current"], posted: false, match: "all" }`. NOTE: `posted: false` may NOT be combined with `recentBatchFromNow` — the latter requires posted questions internally so the combination would always return empty (the tool rejects it with a clear error).',
        ),
      match: z
        .enum(["any", "all"])
        .optional()
        .describe(
          'Combinator across top-level criteria. "all" (default) requires every supplied criterion to be true for a row; "any" requires at least one. Does NOT alter the OR semantics within any single array.',
        ),
      recentBatchFromNow: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Select the Nth most recently posted batch AS OF THE CURRENT MOMENT. 1 = latest, 2 = the one before, etc. REQUIRES `games.length === 1` (batch IDs are unique only within a game). Other filters apply to the question pool BEFORE grouping; the selected batch is returned in full (capped by limit). Legacy questions with no batchId are excluded.",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of questions to return (default 20, most recent first)."),
      includeRevealBlocks: z
        .boolean()
        .optional()
        .describe(
          "Opt-in: when true, each ALREADY-REVEALED row (processedAt set) that has stored authored `revealBlocks` includes them in its response — for re-emitting a deleted card's narrative without regenerating it. Live (not-yet-revealed) rows NEVER carry `revealBlocks` even with this flag, to preserve the no-answer-leak guarantee. Default false: no row carries `revealBlocks`.",
        ),
    },
    async (args) => {
      const games = getGamesFn();
      const limit = args.limit ?? 20;
      const match = args.match ?? "all";
      const includeRevealBlocks = args.includeRevealBlocks ?? false;

      const requestedGames = args.games ?? [];
      const gamesProvided = requestedGames.length > 0;

      let inScopeGames: string[];
      if (gamesProvided) {
        try {
          for (const name of requestedGames) {
            if (games.find((g) => g.name === name) === undefined) {
              throw new UnknownGameError(name);
            }
          }
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
        inScopeGames = [...requestedGames];
      } else {
        inScopeGames = games.map((g) => g.name);
      }

      if (args.recentBatchFromNow !== undefined && requestedGames.length !== 1) {
        return errorResult(
          'recentBatchFromNow requires exactly one game; pass `games: ["<name>"]`.',
        );
      }

      if (args.recentBatchFromNow !== undefined && args.posted === false) {
        return errorResult(
          "`recentBatchFromNow` requires posted questions (postedAt and batchId must be set), but `posted: false` filters those out — the combination would always return empty. Drop `posted: false` or omit `recentBatchFromNow`.",
        );
      }

      const categoriesProvided = (args.categories?.length ?? 0) > 0;
      const seasonsProvided = (args.seasons?.length ?? 0) > 0;
      const keywordsProvided = (args.keywords?.length ?? 0) > 0;

      const categoriesLower = categoriesProvided
        ? (args.categories ?? []).map((c) => c.toLowerCase())
        : [];
      const keywordsLower = keywordsProvided
        ? (args.keywords ?? []).map((k) => k.toLowerCase())
        : [];

      const perGameSeasonSlugs = new Map<string, Set<string>>();
      let seasonsEffective = false;

      if (seasonsProvided) {
        for (const gameName of inScopeGames) {
          const scoped = data.forGame(gameName);
          const seasonsState = await scoped.loadSeasonsState();
          if (seasonsState === null) continue;
          seasonsEffective = true;
          const resolvedSlugs = new Set<string>();
          for (const entry of args.seasons ?? []) {
            if (entry === CURRENT_SEASON_TOKEN) {
              const current = findCurrentSeason(seasonsState, Date.now());
              if (current !== null) resolvedSlugs.add(current.slug);
            } else {
              resolvedSlugs.add(entry);
            }
          }
          perGameSeasonSlugs.set(gameName, resolvedSlugs);
        }
      }

      const useSeasonsCriterion = seasonsProvided && seasonsEffective;

      const allQuestions: QuestionWithGame[] = [];
      for (const gameName of inScopeGames) {
        const scoped = data.forGame(gameName);
        const rows = await scoped.loadQuestions();
        for (const q of rows) {
          allQuestions.push(Object.assign({}, q, { __game: gameName }));
        }
      }

      const filtered = allQuestions.filter((q) => {
        const criteria: boolean[] = [];

        if (gamesProvided) {
          criteria.push(requestedGames.includes(q.__game));
        }

        if (categoriesProvided) {
          criteria.push(categoriesLower.includes(q.category.toLowerCase()));
        }

        if (useSeasonsCriterion) {
          const allowed = perGameSeasonSlugs.get(q.__game);
          criteria.push(allowed !== undefined && q.season !== undefined && allowed.has(q.season));
        }

        if (keywordsProvided) {
          const haystack = keywordHaystackFor(q);
          criteria.push(keywordsLower.some((kw) => haystack.some((h) => h.includes(kw))));
        }

        if (args.posted !== undefined) {
          const isPosted = q.postedAt !== undefined;
          criteria.push(args.posted ? isPosted : !isPosted);
        }

        if (criteria.length === 0) return true;
        return match === "all" ? criteria.every(Boolean) : criteria.some(Boolean);
      });

      function computeMatchedKeywords(q: QuestionWithGame): string[] | null {
        if (!keywordsProvided) return null;
        const haystack = keywordHaystackFor(q);
        const keywords = args.keywords ?? [];
        const hits: string[] = [];
        for (let i = 0; i < keywords.length; i++) {
          if (haystack.some((h) => h.includes(keywordsLower[i]))) hits.push(keywords[i]);
        }
        return hits;
      }

      // Per-game batch facts derived from ALL loaded rows (not the filtered subset):
      // a row's batch is `pending` when no sibling has been revealed (`processedAt`),
      // and `latest` when it is the game's most-recently-posted batch. Ties on the
      // greatest max-postedAt mark every tied batch latest. Posted rows only; the raw
      // batchId is never surfaced. The key joins game + id with a control char that can't
      // occur in either, so distinct (game, id) pairs never collide (a space could).
      const factKey = (q: QuestionWithGame) => `${q.__game}\u0000${q.id}`;
      const batchFacts = new Map<string, { batchPending: boolean; batchIsLatest: boolean }>();
      {
        const perGame = new Map<string, Map<string, { maxPostedAt: number; processed: boolean }>>();
        for (const q of allQuestions) {
          if (q.postedAt === undefined || q.batchId === undefined) continue;
          let batches = perGame.get(q.__game);
          if (batches === undefined) {
            batches = new Map();
            perGame.set(q.__game, batches);
          }
          const existing = batches.get(q.batchId);
          if (existing === undefined) {
            batches.set(q.batchId, {
              maxPostedAt: q.postedAt,
              processed: q.processedAt !== undefined,
            });
          } else {
            existing.maxPostedAt = Math.max(existing.maxPostedAt, q.postedAt);
            existing.processed = existing.processed || q.processedAt !== undefined;
          }
        }
        const gameLatest = new Map<string, number>();
        for (const [game, batches] of perGame) {
          let latest = -Infinity;
          for (const b of batches.values()) latest = Math.max(latest, b.maxPostedAt);
          gameLatest.set(game, latest);
        }
        for (const q of allQuestions) {
          if (q.postedAt === undefined || q.batchId === undefined) continue;
          const batch = perGame.get(q.__game)?.get(q.batchId);
          if (batch === undefined) continue;
          batchFacts.set(factKey(q), {
            batchPending: !batch.processed,
            batchIsLatest: batch.maxPostedAt === gameLatest.get(q.__game),
          });
        }
      }

      if (args.recentBatchFromNow !== undefined) {
        const batched = filtered.filter((q) => q.postedAt !== undefined && q.batchId !== undefined);
        const groups = new Map<string, QuestionWithGame[]>();
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
          .map((q) =>
            toSearchResult(
              q,
              computeMatchedKeywords(q),
              includeRevealBlocks,
              batchFacts.get(factKey(q)),
            ),
          );

        return textResult({
          questions: batchQuestions,
          count: batchQuestions.length,
          total: selected.items.length,
        });
      }

      const sorted = filtered
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map((q) =>
          toSearchResult(
            q,
            computeMatchedKeywords(q),
            includeRevealBlocks,
            batchFacts.get(factKey(q)),
          ),
        );

      return textResult({ questions: sorted, count: sorted.length, total: filtered.length });
    },
  );
}

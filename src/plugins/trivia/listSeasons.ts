import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import type { TriviaDataLayer, SeasonEntry } from "./types.js";

type Status = "past" | "current" | "future";

function statusOf(entry: SeasonEntry, now: number): Status {
  if (entry.startedAt > now) return "future";
  const effectiveEnd = entry.endedAt ?? entry.expectedEndAt;
  if (effectiveEnd <= now) return "past";
  return "current";
}

export function createListSeasonsTool(data: TriviaDataLayer) {
  return tool(
    "list_seasons",
    'List every season on the trivia timeline with full details — slug, dates, categories, and a computed status flag ("past" | "current" | "future"). Use this to inspect what\'s queued, see a future season\'s category pool before it goes live, or audit past seasons. Returns the timeline in stored order (the timeline is naturally ordered by startedAt under the no-overlap invariant).',
    {},
    async () => {
      const state = await data.loadSeasonsState();
      if (state === null) {
        return errorResult("Seasons are not initialized (seasons.json missing). Cannot list.");
      }
      const now = Date.now();
      const seasons = state.seasons.map((entry) => ({
        slug: entry.slug,
        startedAt: entry.startedAt,
        expectedEndAt: entry.expectedEndAt,
        endedAt: entry.endedAt ?? null,
        categories: entry.categories,
        status: statusOf(entry, now),
      }));
      return textResult({ seasons, total: seasons.length });
    },
  );
}

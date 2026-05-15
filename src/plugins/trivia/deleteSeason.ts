import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { findSeasonBySlug } from "./data.js";
import type { TriviaDataLayer } from "./types.js";

export function createDeleteSeasonTool(data: TriviaDataLayer) {
  return tool(
    "delete_season",
    "Remove a not-yet-started season from the timeline. Refuses if the named season has already started (its history is immutable) or if it is the only season on the timeline.",
    {
      slug: z.string().describe("Slug of the season to delete."),
    },
    async (args) => {
      const state = await data.loadSeasonsState();
      if (state === null) {
        return errorResult("Seasons are not initialized — nothing to delete.");
      }
      const target = findSeasonBySlug(state, args.slug);
      if (target === null) {
        return errorResult(`No season with slug "${args.slug}" on the timeline.`);
      }
      if (target.startedAt <= Date.now()) {
        return errorResult(
          `Cannot delete season "${args.slug}": it has already started. Past and current seasons are immutable historical records.`,
        );
      }
      if (state.seasons.length <= 1) {
        return errorResult(
          "Cannot delete the only season on the timeline — at least one season must exist while seasons is enabled.",
        );
      }
      await data.saveSeasonsState({
        seasons: state.seasons.filter((s) => s.slug !== args.slug),
      });
      return textResult({ deleted: args.slug, remaining: state.seasons.length - 1 });
    },
  );
}

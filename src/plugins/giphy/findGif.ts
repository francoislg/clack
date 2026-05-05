import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { searchGiphy, GiphyError } from "./giphy.js";

export interface FindGifDeps {
  searchGiphy: typeof searchGiphy;
  getApiKey: () => string | undefined;
}

export const defaultFindGifDeps: FindGifDeps = {
  searchGiphy,
  getApiKey: () => process.env.GIPHY_API_KEY,
};

const MEDIA_TYPE = z.enum(["gifs", "stickers"]);
const RATING = z.enum(["g", "pg", "pg-13", "r", "y"]);
const SORT = z.enum(["relevant", "recent"]);

export function createFindGifTool(deps: FindGifDeps = defaultFindGifDeps) {
  return tool(
    "find_gif",
    "Search Giphy for a GIF or sticker matching the query. Returns an array of { url, previewUrl, title }. Each call uses a random offset, so repeated calls with the same query won't return the same result. Include the `url` as the `image_url` of a Block Kit `image` block in your submit_response payload — see the Giphy usage instructions for the exact shape. Defaults are SFW: rating=g, type=gifs, sort=relevant, lang=en.",
    {
      query: z
        .string()
        .describe("Short search phrase, e.g. 'celebrate', 'facepalm', 'shipped it'."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Max number of results (default 1)."),
      type: MEDIA_TYPE.optional().describe(
        "Media type: 'gifs' (default) or 'stickers' (transparent-bg, useful in context blocks).",
      ),
      sort: SORT.optional().describe("Sort order: 'relevant' (default) or 'recent'."),
      lang: z.string().optional().describe("ISO language code, e.g. 'en' (default), 'es', 'fr'."),
      rating: RATING.optional().describe(
        "Content rating: 'g' (default, strictest), 'pg', 'pg-13', 'r', 'y'. Stay at 'g' for SFW workplace use.",
      ),
      channel: z
        .string()
        .optional()
        .describe("Optional GIPHY channel slug to scope the search to (e.g. 'nba')."),
    },
    async (args) => {
      const apiKey = deps.getApiKey();
      if (!apiKey) {
        return errorResult(
          "GIPHY_API_KEY is not set. An admin needs to add it to data/auth/.env — see the README for setup steps.",
        );
      }

      try {
        const results = await deps.searchGiphy({
          query: args.query,
          limit: args.limit ?? 1,
          apiKey,
          type: args.type,
          sort: args.sort,
          lang: args.lang,
          rating: args.rating,
          channel: args.channel,
        });
        return textResult(results);
      } catch (err) {
        if (err instanceof GiphyError) {
          return errorResult(`Giphy search failed (HTTP ${err.status}): ${err.message}`);
        }
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Giphy search failed: ${message}`);
      }
    },
  );
}

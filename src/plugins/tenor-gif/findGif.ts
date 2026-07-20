import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../plugins-sdk/sdk.js";
import { searchTenor, TenorError } from "./tenor.js";

export interface FindGifDeps {
  searchTenor: typeof searchTenor;
  getApiKey: () => string | undefined;
}

export const defaultFindGifDeps: FindGifDeps = {
  searchTenor,
  getApiKey: () => process.env.GIF_TENOR_API_KEY,
};

export function createFindGifTool(deps: FindGifDeps = defaultFindGifDeps) {
  return tool(
    "find_gif",
    "Search Tenor for a SFW GIF matching the query. Returns an array of { url, previewUrl, title }. Include the `url` as the `image_url` of a Block Kit `image` block in your submit_response payload — see the GIF usage instructions for the exact shape.",
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
    },
    async (args) => {
      const apiKey = deps.getApiKey();
      if (!apiKey) {
        return errorResult(
          "GIF_TENOR_API_KEY is not set. An admin needs to add it to data/auth/.env — see the README for setup steps.",
        );
      }

      const limit = args.limit ?? 1;

      try {
        const results = await deps.searchTenor({ query: args.query, limit, apiKey });
        return textResult(results);
      } catch (err) {
        if (err instanceof TenorError) {
          return errorResult(`Tenor search failed (HTTP ${err.status}): ${err.message}`);
        }
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Tenor search failed: ${message}`);
      }
    },
  );
}

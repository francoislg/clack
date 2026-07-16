import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { imageAndTextResult, sourceErrorResult, validateQuery } from "../imageSearchResult.js";
import { KEY_MISSING_MESSAGE } from "./backdropTool.js";
import {
  loadTmdbReadToken,
  searchPerson,
  fetchImageBytes,
  cdnUrl,
  PROFILE_SIZE,
  type TmdbDeps,
} from "./tmdb.js";

/** Results considered before giving up — past the top 10 the match is too weak. */
const MAX_RESULTS_CONSIDERED = 10;

const DESCRIPTION =
  "TMDB person image search. Best for the Actors category (also actresses, filmmakers, crew). " +
  "Returns a profile headshot inline for you to inspect, plus name/license/attribution " +
  "metadata. Pass the person's full name as `query`.";

export interface FindPersonDeps {
  loadToken: typeof loadTmdbReadToken;
  search: typeof searchPerson;
  fetchImageBytes: typeof fetchImageBytes;
  tmdbDeps?: TmdbDeps;
}

export const defaultFindPersonDeps: FindPersonDeps = {
  loadToken: loadTmdbReadToken,
  search: searchPerson,
  fetchImageBytes,
};

export function createFindPersonTool(deps: FindPersonDeps = defaultFindPersonDeps) {
  return tool(
    "find_person",
    DESCRIPTION,
    { query: z.string().describe("The person's full name, e.g. 'Brad Pitt'.") },
    async (args) => {
      const token = deps.loadToken();
      if (!token) {
        return sourceErrorResult({ kind: "keyMissing", message: KEY_MISSING_MESSAGE });
      }

      const validated = validateQuery(args.query);
      if (!validated.ok) return sourceErrorResult(validated.error);

      const searchResult = await deps.search(args.query, token, deps.tmdbDeps);
      if (!("ok" in searchResult)) return sourceErrorResult(searchResult);

      // A headshot has no spoiler problem, so no /images hop — the search result's
      // profile_path is already the canonical image. Skip results without one.
      const matched = searchResult.results
        .slice(0, MAX_RESULTS_CONSIDERED)
        .find((result) => result.profile_path);
      if (!matched?.profile_path) {
        return sourceErrorResult({
          kind: "notFound",
          message: `no result with a profile image in the top ${MAX_RESULTS_CONSIDERED}`,
        });
      }

      const imageUrl = cdnUrl(PROFILE_SIZE, matched.profile_path);
      const bytesResult = await deps.fetchImageBytes(imageUrl, token, deps.tmdbDeps);
      if (!("ok" in bytesResult)) return sourceErrorResult(bytesResult);

      return imageAndTextResult(bytesResult.data, bytesResult.mimeType, {
        source: "tmdb",
        subjectId: `tmdb:p-${matched.id}`,
        title: matched.name ?? args.query,
        imageUrl,
        license: "CC BY-NC 4.0",
        attribution: "Data and images via TMDB (themoviedb.org)",
        format: "data",
      });
    },
  );
}

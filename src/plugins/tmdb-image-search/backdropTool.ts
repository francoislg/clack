import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { imageAndTextResult, sourceErrorResult, validateQuery } from "../imageSearchResult.js";
import {
  fetchTextlessBackdrops,
  fetchImageBytes,
  pickBestBackdrop,
  cdnUrl,
  loadTmdbReadToken,
  BACKDROP_SIZE,
  type SourceError,
  type TmdbDeps,
} from "./tmdb.js";

/** Bounds the `/images` round-trips per lookup — beyond the top 3 the query is too obscure. */
export const IMAGES_FETCH_BUDGET = 3;

export const KEY_MISSING_MESSAGE =
  "TMDB read token not configured. Set TMDB_READ_TOKEN in data/auth/.env " +
  "(v4 read access token from themoviedb.org → Settings → API) and restart.";

/** The fields the backdrop flow reads off a movie or TV search result. */
export interface BackdropCandidate {
  id: number;
  backdrop_path?: string | null;
}

export interface BackdropToolDeps<T extends BackdropCandidate> {
  loadToken: typeof loadTmdbReadToken;
  search: (
    query: string,
    token: string,
    deps?: TmdbDeps,
  ) => Promise<{ ok: true; results: T[] } | SourceError>;
  fetchTextlessBackdrops: typeof fetchTextlessBackdrops;
  fetchImageBytes: typeof fetchImageBytes;
  tmdbDeps?: TmdbDeps;
}

export interface BackdropToolConfig<T extends BackdropCandidate> {
  toolName: string;
  description: string;
  querySchemaDescription: string;
  kind: "movie" | "tv";
  subjectIdPrefix: "tmdb:m-" | "tmdb:tv-";
  titleOf: (result: T) => string | undefined;
}

/**
 * Build a `find_movie` / `find_tv` MCP tool. Both share the textless-backdrop resolution
 * (search → `/images?include_image_language=null` → highest-vote backdrop → w780 CDN download)
 * and its spoiler rule: a poster is NEVER returned — no textless backdrop means `notFound`
 * so trivia re-rolls instead of leaking the title.
 */
export function createBackdropTool<T extends BackdropCandidate>(
  config: BackdropToolConfig<T>,
  deps: BackdropToolDeps<T>,
) {
  return tool(
    config.toolName,
    config.description,
    { query: z.string().describe(config.querySchemaDescription) },
    async (args) => {
      const token = deps.loadToken();
      if (!token) {
        return sourceErrorResult({ kind: "keyMissing", message: KEY_MISSING_MESSAGE });
      }

      const validated = validateQuery(args.query);
      if (!validated.ok) return sourceErrorResult(validated.error);

      const searchResult = await deps.search(args.query, token, deps.tmdbDeps);
      if (!("ok" in searchResult)) return sourceErrorResult(searchResult);
      if (searchResult.results.length === 0) {
        return sourceErrorResult({ kind: "notFound", message: "TMDB returned zero results" });
      }

      let chosen: { result: T; filePath: string } | undefined;
      for (const candidate of searchResult.results.slice(0, IMAGES_FETCH_BUDGET)) {
        const imagesResult = await deps.fetchTextlessBackdrops(
          config.kind,
          candidate.id,
          token,
          deps.tmdbDeps,
        );
        if (!("ok" in imagesResult)) return sourceErrorResult(imagesResult);
        const filePath = pickBestBackdrop(imagesResult.backdrops, candidate.backdrop_path ?? null);
        if (filePath) {
          chosen = { result: candidate, filePath };
          break;
        }
      }
      if (!chosen) {
        return sourceErrorResult({
          kind: "notFound",
          message: `no textless backdrop among the top ${IMAGES_FETCH_BUDGET} results — never falling back to a poster`,
        });
      }

      const imageUrl = cdnUrl(BACKDROP_SIZE, chosen.filePath);
      const bytesResult = await deps.fetchImageBytes(imageUrl, token, deps.tmdbDeps);
      if (!("ok" in bytesResult)) return sourceErrorResult(bytesResult);

      return imageAndTextResult(bytesResult.data, bytesResult.mimeType, {
        source: "tmdb",
        subjectId: `${config.subjectIdPrefix}${chosen.result.id}`,
        title: config.titleOf(chosen.result) ?? args.query,
        imageUrl,
        license: "CC BY-NC 4.0",
        attribution: "Data and images via TMDB (themoviedb.org)",
        format: "data",
      });
    },
  );
}

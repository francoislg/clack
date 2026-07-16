import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  searchReleaseGroups,
  fetchFrontCover,
  fetchImageBytes,
  type ReleaseGroup,
  type SourceError,
  type MusicBrainzDeps,
} from "./musicbrainz.js";

const MAX_QUERY_LENGTH = 200;
/** Bounds the CAA round-trips per lookup — beyond the top 3 the query is too obscure. */
const CAA_FETCH_BUDGET = 3;

const DESCRIPTION =
  "Album cover art via MusicBrainz + Cover Art Archive (keyless). Best for 'what album is this " +
  "cover?'. Returns the canonical front cover inline plus artist/album metadata. Pass " +
  "`artist album` (e.g. 'Nirvana Nevermind') or an album title as `query`. Check the returned " +
  "`title` — tribute/cover albums can outrank the original; if it names the wrong artist, retry " +
  "with a more distinctive query. Note: some covers print the title — prefer iconic textless " +
  "covers for guessing.";

export interface FindAlbumDeps {
  searchReleaseGroups: typeof searchReleaseGroups;
  fetchFrontCover: typeof fetchFrontCover;
  fetchImageBytes: typeof fetchImageBytes;
  musicBrainzDeps?: MusicBrainzDeps;
}

export const defaultFindAlbumDeps: FindAlbumDeps = {
  searchReleaseGroups,
  fetchFrontCover,
  fetchImageBytes,
};

/**
 * Data-mode multimodal result: one base64 image content block (for Claude to inspect) + one text
 * block carrying the metadata JSON. Both shapes are valid MCP `CallToolResult` content.
 */
function imageAndTextResult(data: string, mimeType: string, metadata: unknown) {
  return {
    content: [
      { type: "image" as const, data, mimeType },
      { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
    ],
  };
}

function sourceErrorResult(err: SourceError) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(err) }],
    isError: true as const,
  };
}

function albumTitle(releaseGroup: ReleaseGroup): string {
  const artist = releaseGroup["artist-credit"]?.[0]?.name;
  const title = releaseGroup.title ?? "";
  return artist ? `${artist} – ${title}` : title;
}

export function createFindAlbumTool(deps: FindAlbumDeps = defaultFindAlbumDeps) {
  return tool(
    "find_album",
    DESCRIPTION,
    {
      query: z
        .string()
        .describe("Artist + album (e.g. 'Nirvana Nevermind') or an album title alone."),
    },
    async (args) => {
      const query = args.query.trim();
      if (query.length === 0) {
        return sourceErrorResult({ kind: "notFound", message: "query is empty" });
      }
      if (query.length > MAX_QUERY_LENGTH) {
        return sourceErrorResult({
          kind: "notFound",
          message: `query exceeds ${MAX_QUERY_LENGTH} characters`,
        });
      }

      const searchResult = await deps.searchReleaseGroups(query, deps.musicBrainzDeps);
      if (!("ok" in searchResult)) return sourceErrorResult(searchResult);
      if (searchResult.releaseGroups.length === 0) {
        return sourceErrorResult({
          kind: "notFound",
          message: `no MusicBrainz release-group matches "${query}"`,
        });
      }

      // Candidate fall-through: a release-group with no cover art (CAA 404) advances to the
      // next MusicBrainz result; any other CAA failure aborts the lookup.
      let selected: { releaseGroup: ReleaseGroup; coverUrl: string } | undefined;
      for (const releaseGroup of searchResult.releaseGroups.slice(0, CAA_FETCH_BUDGET)) {
        const coverResult = await deps.fetchFrontCover(releaseGroup.id, deps.musicBrainzDeps);
        if ("ok" in coverResult) {
          selected = { releaseGroup, coverUrl: coverResult.coverUrl };
          break;
        }
        if (coverResult.kind !== "notFound") return sourceErrorResult(coverResult);
      }
      if (!selected) {
        return sourceErrorResult({
          kind: "notFound",
          message: "no cover art in top candidates",
        });
      }

      const bytesResult = await deps.fetchImageBytes(selected.coverUrl, deps.musicBrainzDeps);
      if (!("ok" in bytesResult)) return sourceErrorResult(bytesResult);

      return imageAndTextResult(bytesResult.data, bytesResult.mimeType, {
        source: "coverart",
        subjectId: `coverart:rg-${selected.releaseGroup.id}`,
        title: albumTitle(selected.releaseGroup),
        imageUrl: selected.coverUrl,
        license: "unknown",
        attribution: "via Cover Art Archive",
        format: "data",
      });
    },
  );
}

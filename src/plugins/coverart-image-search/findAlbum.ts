import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { imageAndTextResult, sourceErrorResult, validateQuery } from "../imageSearchResult.js";
import {
  searchReleaseGroups,
  fetchFrontCover,
  fetchImageBytes,
  type ReleaseGroup,
  type MusicBrainzDeps,
} from "./musicbrainz.js";

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
      const validated = validateQuery(args.query);
      if (!validated.ok) return sourceErrorResult(validated.error);
      const query = validated.query;

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

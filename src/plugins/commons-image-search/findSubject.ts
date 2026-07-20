import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { imageAndTextResult, sourceErrorResult, validateQuery } from "../../plugins-sdk/sdk.js";
import {
  fetchPageSummary,
  fetchImageInfo,
  fetchImageBytes,
  sourceFilenameFromThumbUrl,
  type WikimediaDeps,
} from "./wikimedia.js";

const DESCRIPTION =
  "Wikipedia/Wikimedia Commons image search. Best for: flags, country symbols, world leaders, " +
  "historical figures, landmarks, paintings, sculptures, currencies, animals (when the species " +
  "has a Wikipedia article). Returns the article's canonical thumbnail image (inline, for you to " +
  "inspect) plus license/attribution metadata. Pass the subject's English Wikipedia title as `query`.";

export interface FindSubjectDeps {
  fetchPageSummary: typeof fetchPageSummary;
  fetchImageInfo: typeof fetchImageInfo;
  fetchImageBytes: typeof fetchImageBytes;
  wikimediaDeps?: WikimediaDeps;
}

export const defaultFindSubjectDeps: FindSubjectDeps = {
  fetchPageSummary,
  fetchImageInfo,
  fetchImageBytes,
};

function slugFromTitle(title: string): string {
  return encodeURIComponent(title.replace(/ /g, "_"));
}

export function createFindSubjectTool(deps: FindSubjectDeps = defaultFindSubjectDeps) {
  return tool(
    "find_subject",
    DESCRIPTION,
    { query: z.string().describe("English Wikipedia title of the subject, e.g. 'Eiffel Tower'.") },
    async (args) => {
      const validated = validateQuery(args.query);
      if (!validated.ok) return sourceErrorResult(validated.error);

      const summaryResult = await deps.fetchPageSummary(args.query, deps.wikimediaDeps);
      if (!("ok" in summaryResult)) return sourceErrorResult(summaryResult);
      const summary = summaryResult.summary;

      const thumbnailUrl = summary.thumbnail?.source;
      if (!thumbnailUrl) {
        return sourceErrorResult({
          kind: "unknown",
          message: "page summary has no thumbnail.source",
        });
      }
      if (thumbnailUrl.toLowerCase().endsWith(".svg")) {
        return sourceErrorResult({
          kind: "unsupportedFormat",
          message: "thumbnail.source is an SVG and won't render reliably in Slack",
        });
      }

      // Download the thumbnail bytes — required, since the image block is data-mode.
      const bytesResult = await deps.fetchImageBytes(thumbnailUrl, deps.wikimediaDeps);
      if (!("ok" in bytesResult)) return sourceErrorResult(bytesResult);

      // License/attribution is best-effort: an imageinfo failure degrades to defaults rather than
      // failing the whole lookup (design.md Decision 4).
      let license = "unknown";
      let attribution = "via Wikimedia Commons";
      const filename = sourceFilenameFromThumbUrl(thumbnailUrl);
      const infoResult = await deps.fetchImageInfo(filename, deps.wikimediaDeps);
      if ("ok" in infoResult) {
        license = infoResult.license;
        attribution = infoResult.attribution;
      }

      const subjectId = summary.wikibase_item
        ? `wikidata:${summary.wikibase_item}`
        : `wikipedia:${slugFromTitle(summary.title ?? args.query)}`;

      return imageAndTextResult(bytesResult.data, bytesResult.mimeType, {
        source: "commons",
        subjectId,
        title: summary.title ?? args.query,
        imageUrl: thumbnailUrl,
        license,
        attribution,
        format: "data",
      });
    },
  );
}

import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  fetchPageSummary,
  fetchImageInfo,
  fetchImageBytes,
  sourceFilenameFromThumbUrl,
  type SourceError,
  type WikimediaDeps,
} from "./wikimedia.js";

const MAX_QUERY_LENGTH = 200;

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

function slugFromTitle(title: string): string {
  return encodeURIComponent(title.replace(/ /g, "_"));
}

export function createFindSubjectTool(deps: FindSubjectDeps = defaultFindSubjectDeps) {
  return tool(
    "find_subject",
    DESCRIPTION,
    { query: z.string().describe("English Wikipedia title of the subject, e.g. 'Eiffel Tower'.") },
    async (args) => {
      const query = args.query.trim();
      if (query.length === 0) {
        return sourceErrorResult({ kind: "notFound", message: "query is empty" });
      }
      if (args.query.length > MAX_QUERY_LENGTH) {
        return sourceErrorResult({
          kind: "notFound",
          message: `query exceeds ${MAX_QUERY_LENGTH} characters`,
        });
      }

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

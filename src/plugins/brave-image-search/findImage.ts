import { createHash } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  loadBraveApiKey,
  searchImages,
  fetchImageBytes,
  selectRenderableResult,
  type SourceError,
  type BraveDeps,
} from "./brave.js";

const MAX_QUERY_LENGTH = 200;

const DESCRIPTION =
  "Generic web image search via Brave Search. Best for: long-tail subjects not covered by " +
  "specialized image-search plugins — movie scenes, TV stills, video game character art, " +
  "anime/comic characters, contemporary pop culture, regional figures. Returns the top-ranked " +
  "renderable image (JPEG/PNG/WebP/GIF, inline for you to inspect). License is always 'unknown'; " +
  "attribution is the source-page domain. Pass a descriptive subject query (e.g., 'Inception " +
  "staircase scene', 'Pikachu character art').";

export interface FindImageDeps {
  loadApiKey: typeof loadBraveApiKey;
  searchImages: typeof searchImages;
  fetchImageBytes: typeof fetchImageBytes;
  braveDeps?: BraveDeps;
}

export const defaultFindImageDeps: FindImageDeps = {
  loadApiKey: loadBraveApiKey,
  searchImages,
  fetchImageBytes,
};

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

function subjectIdFromUrl(imageUrl: string): string {
  const hash = createHash("sha256").update(imageUrl).digest("hex");
  return `brave:${hash.slice(0, 12)}`;
}

function attributionFromSource(source: string | undefined): string {
  if (!source) return "via Brave Search";
  try {
    const host = new URL(source).host;
    return host ? `via ${host}` : "via Brave Search";
  } catch {
    return "via Brave Search";
  }
}

export function createFindImageTool(deps: FindImageDeps = defaultFindImageDeps) {
  return tool(
    "find_image",
    DESCRIPTION,
    { query: z.string().describe("Descriptive subject query, e.g. 'Inception staircase scene'.") },
    async (args) => {
      const apiKey = deps.loadApiKey();
      if (!apiKey) {
        return sourceErrorResult({
          kind: "keyMissing",
          message: "Brave Search API key not configured — set BRAVE_API_KEY in data/auth/.env",
        });
      }

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

      const searchResult = await deps.searchImages(args.query, apiKey, deps.braveDeps);
      if (!("ok" in searchResult)) return sourceErrorResult(searchResult);

      const selected = selectRenderableResult(searchResult.results);
      if (!selected) {
        return sourceErrorResult({
          kind: "notFound",
          message: "no renderable image in top 10 results",
        });
      }

      const bytesResult = await deps.fetchImageBytes(selected.imageUrl, deps.braveDeps);
      if (!("ok" in bytesResult)) return sourceErrorResult(bytesResult);

      return imageAndTextResult(bytesResult.data, bytesResult.mimeType, {
        source: "brave",
        subjectId: subjectIdFromUrl(selected.imageUrl),
        title: selected.result.title ?? args.query,
        imageUrl: selected.imageUrl,
        license: "unknown",
        attribution: attributionFromSource(selected.result.source),
        format: "data",
      });
    },
  );
}

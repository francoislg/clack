import { extractSlackFiles, IMAGE_MIME_TYPES, type SlackFileBase } from "./slackFileBase.js";

/** MIME types that can be read as UTF-8 text. */
const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/x-sh",
]);

/** Classify a MIME type into a viewing tier. */
export function classifyMimeType(mimetype: string): "pdf" | "text" | "unsupported" {
  if (mimetype === "application/pdf") return "pdf";
  if (TEXT_MIME_PREFIXES.some((p) => mimetype.startsWith(p))) return "text";
  if (TEXT_MIME_EXACT.has(mimetype)) return "text";
  return "unsupported";
}

/**
 * Extract non-image files from a Slack message's `.files` array.
 * Captures PDFs, text-based files, and unsupported binaries (metadata-only).
 * Excludes image MIME types (handled by imageExtractor).
 */
export function extractFiles(files?: unknown[]) {
  return extractSlackFiles(files, (m) => !IMAGE_MIME_TYPES.has(m));
}

/** Combined extraction result for images + files from a Slack message. */
export interface ExtractedAttachments {
  imageFiles?: SlackFileBase[];
  files?: SlackFileBase[];
}

/**
 * Extract both images and non-image files from a Slack message's `.files` array.
 * Returns only non-empty arrays (omits keys when empty).
 */
export function extractAttachments(rawFiles: unknown[] | undefined): ExtractedAttachments {
  const imageFiles = extractSlackFiles(rawFiles, (m) => IMAGE_MIME_TYPES.has(m));
  const files = extractSlackFiles(rawFiles, (m) => !IMAGE_MIME_TYPES.has(m));
  return {
    ...(imageFiles.length > 0 && { imageFiles }),
    ...(files.length > 0 && { files }),
  };
}

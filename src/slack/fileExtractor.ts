import { extractAllSlackFiles, type SlackFileBase } from "./slackFileBase.js";

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

/** Every file attached to a Slack message, of every kind. */
export interface ExtractedAttachments {
  files?: SlackFileBase[];
}

/**
 * Extract every file from a Slack message's `.files` array into one list.
 * Omits `files` when the message carries none.
 */
export function extractAttachments(rawFiles: unknown[] | undefined): ExtractedAttachments {
  const files = extractAllSlackFiles(rawFiles);
  return files.length > 0 ? { files } : {};
}

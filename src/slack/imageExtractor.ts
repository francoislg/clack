import { extractSlackFiles, IMAGE_MIME_TYPES } from "./slackFileBase.js";

/**
 * Extract supported image files from a Slack message's `.files` array.
 * Filters for supported MIME types, enforces size/count limits, and
 * validates required fields.
 */
export function extractImageFiles(files?: unknown[]) {
  return extractSlackFiles(files, (m) => IMAGE_MIME_TYPES.has(m));
}

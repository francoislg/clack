/** Shared MIME types for image files — used by both extractors. */
export const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES_PER_MESSAGE = 10;

export interface SlackFileBase {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private: string;
}

/** Semantic alias for image files (structurally identical to SlackFileBase). */
export type SlackImageFile = SlackFileBase;

/** Semantic alias for non-image files (structurally identical to SlackFileBase). */
export type SlackFile = SlackFileBase;

/**
 * Extract files from a Slack message's `.files` array, filtered by a MIME predicate.
 * Handles validation, size limits, and count caps.
 */
export function extractSlackFiles(
  files: unknown[] | undefined,
  mimeFilter: (mimetype: string) => boolean,
): SlackFileBase[] {
  if (!Array.isArray(files) || files.length === 0) return [];

  const result: SlackFileBase[] = [];

  for (const file of files) {
    if (result.length >= MAX_FILES_PER_MESSAGE) break;
    if (!file || typeof file !== "object") continue;

    const f = file as Record<string, unknown>;

    const id = f.id;
    const name = f.name;
    const mimetype = f.mimetype;
    const size = f.size;
    const url_private = f.url_private;

    if (
      typeof id !== "string" ||
      !id ||
      typeof name !== "string" ||
      !name ||
      typeof mimetype !== "string" ||
      typeof size !== "number" ||
      typeof url_private !== "string" ||
      !url_private
    ) {
      continue;
    }

    if (!mimeFilter(mimetype)) continue;
    if (size > MAX_FILE_SIZE) continue;

    result.push({ id, name, mimetype, size, url_private });
  }

  return result;
}

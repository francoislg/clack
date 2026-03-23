const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_IMAGES_PER_MESSAGE = 10;

export interface SlackImageFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private: string;
}

/**
 * Extract supported image files from a Slack message's `.files` array.
 * Filters for supported MIME types, enforces size/count limits, and
 * validates required fields.
 */
export function extractImageFiles(files?: unknown[]): SlackImageFile[] {
  if (!Array.isArray(files) || files.length === 0) return [];

  const images: SlackImageFile[] = [];

  for (const file of files) {
    if (images.length >= MAX_IMAGES_PER_MESSAGE) break;
    if (!file || typeof file !== "object") continue;

    const f = file as Record<string, unknown>;

    const id = f.id;
    const name = f.name;
    const mimetype = f.mimetype;
    const size = f.size;
    const url_private = f.url_private;

    if (
      typeof id !== "string" || !id ||
      typeof name !== "string" || !name ||
      typeof mimetype !== "string" ||
      typeof size !== "number" ||
      typeof url_private !== "string" || !url_private
    ) {
      continue;
    }

    if (!SUPPORTED_MIME_TYPES.has(mimetype)) continue;
    if (size > MAX_FILE_SIZE) continue;

    images.push({ id, name, mimetype, size, url_private });
  }

  return images;
}

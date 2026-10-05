import { z } from "zod";

/** MIME types of the image files Claude can view. */
export const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES_PER_MESSAGE = 10;

export interface SlackFileBase {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private: string;
  /** Slack's file type (e.g. "list", "quip", "pdf"). */
  filetype?: string;
  /** Slack's human-readable type label (e.g. "PDF", "Canvas"). */
  pretty_type?: string;
  /**
   * Why this attachment cannot be opened. Oversized files stay in the list so
   * Claude can tell the user the attachment exists and was not read, rather
   * than answering as if the message carried nothing.
   */
  unavailable?: "too_large";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Semantic alias for image files (structurally identical to SlackFileBase). */
export type SlackImageFile = SlackFileBase;

/** Semantic alias for non-image files (structurally identical to SlackFileBase). */
export type SlackFile = SlackFileBase;

/** One file object from a Slack message's `.files` array. Optional type labels never reject a file. */
export const slackFileZod = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimetype: z.string(),
  size: z.number(),
  url_private: z.string().min(1),
  filetype: z.string().optional().catch(undefined),
  pretty_type: z.string().optional().catch(undefined),
});

function toSlackFile(raw: unknown): SlackFileBase | null {
  const parsed = slackFileZod.safeParse(raw);
  if (!parsed.success) return null;
  const { filetype, pretty_type, ...required } = parsed.data;
  return {
    ...required,
    ...(filetype !== undefined && { filetype }),
    ...(pretty_type !== undefined && { pretty_type }),
    ...(required.size > MAX_FILE_SIZE && { unavailable: "too_large" as const }),
  };
}

/**
 * Extract every file of a Slack message's `.files` array into one list, in message order.
 * Malformed file objects are skipped. Keeps at most 10 images and 10 other files.
 */
export function extractAllSlackFiles(files: unknown[] | undefined): SlackFileBase[] {
  if (!Array.isArray(files)) return [];

  const result: SlackFileBase[] = [];
  let images = 0;
  let others = 0;
  for (const raw of files) {
    const file = toSlackFile(raw);
    if (!file) continue;
    if (IMAGE_MIME_TYPES.has(file.mimetype)) {
      if (images >= MAX_FILES_PER_MESSAGE) continue;
      images++;
    } else {
      if (others >= MAX_FILES_PER_MESSAGE) continue;
      others++;
    }
    result.push(file);
  }
  return result;
}

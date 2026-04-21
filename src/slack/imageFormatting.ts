import type { SlackFileBase } from "./slackFileBase.js";

/**
 * Build a pre-analysis placeholder describing attached images, matching the
 * `[attached images: ...]` tag the prompt builder uses in thread context.
 * Used when a message has no text but carries image uploads so pre-analysis
 * still has something textual to classify.
 */
export function buildImageOnlyPreAnalysisText(images: SlackFileBase[] | undefined): string {
  if (!images?.length) return "";
  const tags = images.map((f) => `${f.name} (file_id: ${f.id})`).join(", ");
  return `[attached images: ${tags}]`;
}

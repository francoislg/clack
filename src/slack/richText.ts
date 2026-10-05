import type { RichTextBlock } from "@slack/types";

/** A rich_text block holding one section of plain text. */
export function toRichText(text: string): RichTextBlock {
  return {
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }],
  };
}

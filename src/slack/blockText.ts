import type { Block } from "./blockSchema.js";

/**
 * Extract human-readable text from a Block[] — used for the `submit_response`
 * 10000-char length check and for the plain-text Slack `text:` fallback
 * (notifications / accessibility). Walks each block and concatenates the
 * visible strings; does not try to reproduce rich formatting.
 */
export function extractDisplayText(blocks: readonly Block[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "header":
        parts.push(block.text.text);
        break;
      case "section": {
        if (block.text) parts.push(block.text.text);
        if (block.fields) {
          for (const field of block.fields) {
            parts.push(field.text);
          }
        }
        break;
      }
      case "context": {
        for (const el of block.elements) {
          if (el.type === "mrkdwn" || el.type === "plain_text") {
            parts.push(el.text);
          }
        }
        break;
      }
      case "image":
        parts.push(block.alt_text);
        break;
      case "markdown":
        parts.push(block.text);
        break;
      case "card": {
        if (block.title) parts.push(block.title.text);
        if (block.subtitle) parts.push(block.subtitle.text);
        if (block.body) parts.push(block.body.text);
        if (block.hero_image?.alt_text) parts.push(block.hero_image.alt_text);
        if (block.icon?.alt_text) parts.push(block.icon.alt_text);
        break;
      }
      case "carousel": {
        for (const card of block.elements) {
          if (card.title) parts.push(card.title.text);
          if (card.subtitle) parts.push(card.subtitle.text);
          if (card.body) parts.push(card.body.text);
          if (card.hero_image?.alt_text) parts.push(card.hero_image.alt_text);
          if (card.icon?.alt_text) parts.push(card.icon.alt_text);
        }
        break;
      }
      case "divider":
        break;
    }
  }
  return parts.join("\n\n");
}

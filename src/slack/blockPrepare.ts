import type { SectionBlock, ContextBlock, PlainTextElement, MrkdwnElement } from "@slack/types";
import { convertMarkdownToSlack, splitForSlack } from "../claude/formatting.js";
import type { Block } from "./blockSchema.js";

const SECTION_TEXT_LIMIT = 3000;

// ============================================================================
// Per-type preparers
// ============================================================================

type TextObject = PlainTextElement | MrkdwnElement;

function prepareTextObject(t: TextObject): TextObject {
  if (t.type === "mrkdwn") {
    return { ...t, text: convertMarkdownToSlack(t.text) };
  }
  return t;
}

/**
 * Split a section block whose mrkdwn text exceeds the 3000-char Slack limit
 * into multiple section blocks. Fields are paired with the first chunk only
 * (Slack pairs fields with a single section).
 */
function splitOversizeSection(block: SectionBlock, chunks: readonly string[]): SectionBlock[] {
  const originalText = block.text;
  if (!originalText) {
    // No text to split; caller should not have invoked this path.
    return [block];
  }
  const convertedFields = block.fields?.map((f) => prepareTextObject(f));

  return chunks.map((chunk, ci) => {
    const clone: SectionBlock = {
      ...block,
      text: { ...originalText, text: chunk },
    };
    if (ci === 0) {
      if (convertedFields) clone.fields = convertedFields;
    } else {
      // Strip fields on non-first chunks.
      delete clone.fields;
    }
    return clone;
  });
}

function prepareSection(block: SectionBlock): SectionBlock[] {
  const convertedFields = block.fields?.map((f) => prepareTextObject(f));

  if (block.text === undefined) {
    // Fields-only section (or malformed — validator flags it downstream).
    const prepared: SectionBlock = { ...block };
    if (convertedFields) prepared.fields = convertedFields;
    return [prepared];
  }

  const isMrkdwn = block.text.type === "mrkdwn";
  const converted = isMrkdwn ? convertMarkdownToSlack(block.text.text) : block.text.text;
  const chunks = isMrkdwn ? splitForSlack(converted, SECTION_TEXT_LIMIT) : [converted];

  if (chunks.length === 1) {
    const prepared: SectionBlock = {
      ...block,
      text: { ...block.text, text: chunks[0] },
    };
    if (convertedFields) prepared.fields = convertedFields;
    return [prepared];
  }

  return splitOversizeSection(block, chunks);
}

function prepareContext(block: ContextBlock): ContextBlock {
  const convertedElements = block.elements.map((el) => {
    if (el.type === "mrkdwn") {
      return { ...el, text: convertMarkdownToSlack(el.text) };
    }
    return el;
  });
  return { ...block, elements: convertedElements };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Prepare a Claude-authored blocks array for delivery to Slack:
 *   - Convert internal markdown to Slack mrkdwn on schema-known text fields
 *     (section.text of type mrkdwn, context elements of type mrkdwn,
 *     section.fields items of type mrkdwn).
 *   - Split oversize section text (> 3000 chars) into multiple section blocks.
 *   - Leave header text (plain_text), image fields, and any passthrough
 *     optional fields (block_id, confirm, accessibility_label, …) untouched.
 *
 * Returns a NEW array — does not mutate the input.
 */
export function prepareBlocks(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "section":
        out.push(...prepareSection(block));
        break;
      case "context":
        out.push(prepareContext(block));
        break;
      case "divider":
      case "header":
      case "image":
        // No markdown conversion: header uses plain_text, image has no mrkdwn
        // text fields, and divider has nothing. Shallow-copy preserves any
        // passthrough optional fields verbatim.
        out.push({ ...block });
        break;
    }
  }
  return out;
}

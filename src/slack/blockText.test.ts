import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Block } from "./blockSchema.js";
import { extractDisplayText } from "./blockText.js";

describe("extractDisplayText", () => {
  it("returns empty string for empty block array", () => {
    assert.equal(extractDisplayText([]), "");
  });

  it("returns empty string for a divider-only block array", () => {
    const blocks: Block[] = [{ type: "divider" }];
    assert.equal(extractDisplayText(blocks), "");
  });

  it("extracts plain_text from a header block", () => {
    const blocks: Block[] = [{ type: "header", text: { type: "plain_text", text: "Hello world" } }];
    assert.equal(extractDisplayText(blocks), "Hello world");
  });

  it("extracts mrkdwn text from a section block", () => {
    const blocks: Block[] = [{ type: "section", text: { type: "mrkdwn", text: "A *bold* point" } }];
    assert.equal(extractDisplayText(blocks), "A *bold* point");
  });

  it("extracts text + fields from a section block", () => {
    const blocks: Block[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Summary" },
        fields: [
          { type: "mrkdwn", text: "Field A" },
          { type: "mrkdwn", text: "Field B" },
        ],
      },
    ];
    assert.equal(extractDisplayText(blocks), "Summary\n\nField A\n\nField B");
  });

  it("extracts mrkdwn + plain_text from a context block", () => {
    const blocks: Block[] = [
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "_meta_" },
          { type: "plain_text", text: "info" },
        ],
      },
    ];
    assert.equal(extractDisplayText(blocks), "_meta_\n\ninfo");
  });

  it("ignores image elements inside context blocks", () => {
    const blocks: Block[] = [
      {
        type: "context",
        elements: [
          { type: "image", image_url: "https://x", alt_text: "x" },
          { type: "mrkdwn", text: "caption" },
        ],
      },
    ];
    assert.equal(extractDisplayText(blocks), "caption");
  });

  it("falls back to alt_text for image blocks", () => {
    const blocks: Block[] = [
      {
        type: "image",
        image_url: "https://example.com/a.png",
        alt_text: "A cat",
      },
    ];
    assert.equal(extractDisplayText(blocks), "A cat");
  });

  it("joins multiple blocks with double newlines", () => {
    const blocks: Block[] = [
      { type: "header", text: { type: "plain_text", text: "Title" } },
      { type: "section", text: { type: "mrkdwn", text: "Body" } },
    ];
    assert.equal(extractDisplayText(blocks), "Title\n\nBody");
  });
});

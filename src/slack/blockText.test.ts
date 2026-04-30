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

  it("extracts text from a markdown block", () => {
    const blocks: Block[] = [{ type: "markdown", text: "## Heading\n\nProse" }];
    assert.equal(extractDisplayText(blocks), "## Heading\n\nProse");
  });

  it("walks card fields in title / subtitle / body order, then alt_texts", () => {
    const blocks: Block[] = [
      {
        type: "card",
        title: { type: "mrkdwn", text: "PR #42" },
        subtitle: { type: "mrkdwn", text: "Open" },
        body: { type: "mrkdwn", text: "Refactor worker" },
        hero_image: { type: "image", image_url: "https://example.com/h.png", alt_text: "hero" },
        icon: { type: "image", image_url: "https://example.com/i.png", alt_text: "icon" },
      },
    ];
    assert.equal(extractDisplayText(blocks), "PR #42\n\nOpen\n\nRefactor worker\n\nhero\n\nicon");
  });

  it("omits absent card fields", () => {
    const blocks: Block[] = [{ type: "card", title: { type: "mrkdwn", text: "Just a title" } }];
    assert.equal(extractDisplayText(blocks), "Just a title");
  });

  it("walks each child of a carousel", () => {
    const blocks: Block[] = [
      {
        type: "carousel",
        elements: [
          { type: "card", title: { type: "mrkdwn", text: "A" } },
          {
            type: "card",
            title: { type: "mrkdwn", text: "B" },
            body: { type: "mrkdwn", text: "B body" },
          },
        ],
      },
    ];
    assert.equal(extractDisplayText(blocks), "A\n\nB\n\nB body");
  });
});

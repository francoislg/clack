import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BlockSchema, ALLOWED_BLOCK_TYPES } from "./blockSchema.js";

describe("BlockSchema.parse — allowed block types", () => {
  it("accepts a minimal divider", () => {
    const parsed = BlockSchema.parse({ type: "divider" });
    assert.equal(parsed.type, "divider");
  });

  it("accepts a header with plain_text", () => {
    const parsed = BlockSchema.parse({
      type: "header",
      text: { type: "plain_text", text: "Hello" },
    });
    assert.equal(parsed.type, "header");
    if (parsed.type === "header") {
      assert.equal(parsed.text.text, "Hello");
    }
  });

  it("accepts a section with mrkdwn text", () => {
    const parsed = BlockSchema.parse({
      type: "section",
      text: { type: "mrkdwn", text: "A *bold* move" },
    });
    assert.equal(parsed.type, "section");
  });

  it("accepts a section with fields array", () => {
    const parsed = BlockSchema.parse({
      type: "section",
      fields: [
        { type: "mrkdwn", text: "*Name:*\nAlice" },
        { type: "mrkdwn", text: "*Role:*\nAdmin" },
      ],
    });
    assert.equal(parsed.type, "section");
    if (parsed.type === "section") {
      assert.equal(parsed.fields?.length, 2);
    }
  });

  it("accepts a context with mrkdwn and image elements", () => {
    const parsed = BlockSchema.parse({
      type: "context",
      elements: [
        { type: "mrkdwn", text: "Source: docs" },
        {
          type: "image",
          image_url: "https://example.com/icon.png",
          alt_text: "icon",
        },
      ],
    });
    assert.equal(parsed.type, "context");
  });

  it("accepts an image with required fields", () => {
    const parsed = BlockSchema.parse({
      type: "image",
      image_url: "https://example.com/x.png",
      alt_text: "X",
    });
    assert.equal(parsed.type, "image");
  });
});

describe("BlockSchema.parse — disallowed block types", () => {
  it("rejects an actions block", () => {
    assert.throws(() => BlockSchema.parse({ type: "actions", elements: [] }));
  });

  it("rejects an input block", () => {
    assert.throws(() => BlockSchema.parse({ type: "input" }));
  });

  it("rejects a rich_text block", () => {
    assert.throws(() => BlockSchema.parse({ type: "rich_text" }));
  });

  it("rejects an unknown block type", () => {
    assert.throws(() => BlockSchema.parse({ type: "made_up_block_type" }));
  });
});

describe("BlockSchema passthrough behavior", () => {
  it("preserves block_id on a section block", () => {
    const parsed = BlockSchema.parse({
      type: "section",
      text: { type: "mrkdwn", text: "hi" },
      block_id: "intro_section",
    });
    // block_id is a passthrough field — not in the typed shape, but present at runtime
    assert.ok("block_id" in parsed);
    if ("block_id" in parsed) {
      assert.equal(parsed.block_id, "intro_section");
    }
  });

  it("preserves accessibility_label on a header", () => {
    const parsed = BlockSchema.parse({
      type: "header",
      text: { type: "plain_text", text: "Welcome" },
      accessibility_label: "welcome-header",
    });
    assert.ok("accessibility_label" in parsed);
    if ("accessibility_label" in parsed) {
      assert.equal(parsed.accessibility_label, "welcome-header");
    }
  });

  it("preserves emoji on plain_text", () => {
    const parsed = BlockSchema.parse({
      type: "header",
      text: { type: "plain_text", text: "Hi", emoji: false },
    });
    if (parsed.type === "header") {
      assert.equal(parsed.text.emoji, false);
    }
  });

  it("preserves verbatim on mrkdwn", () => {
    const parsed = BlockSchema.parse({
      type: "section",
      text: { type: "mrkdwn", text: "hi", verbatim: true },
    });
    if (parsed.type === "section" && parsed.text && "verbatim" in parsed.text) {
      assert.equal(parsed.text.verbatim, true);
    } else {
      assert.fail("expected parsed.text to carry verbatim");
    }
  });
});

describe("ALLOWED_BLOCK_TYPES", () => {
  it("lists all curated type names", () => {
    assert.deepEqual([...ALLOWED_BLOCK_TYPES].sort(), [
      "context",
      "divider",
      "header",
      "image",
      "section",
    ]);
  });

  it("does not include actions", () => {
    assert.equal((ALLOWED_BLOCK_TYPES as readonly string[]).includes("actions"), false);
  });
});

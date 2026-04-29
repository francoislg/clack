import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BlockSchema, ALLOWED_BLOCK_TYPES, tableBlockSchema } from "./blockSchema.js";

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

  it("accepts a markdown block with non-empty text", () => {
    const parsed = BlockSchema.parse({
      type: "markdown",
      text: "## Heading\n\nSome **bold** prose with `code`.",
    });
    assert.equal(parsed.type, "markdown");
    if (parsed.type === "markdown") {
      assert.match(parsed.text, /^## Heading/);
    }
  });
});

describe("tableBlockSchema.parse — standalone table parameter", () => {
  it("accepts a table with bare-string cells", () => {
    const parsed = tableBlockSchema.parse({
      type: "table",
      rows: [
        ["Repo", "Status"],
        ["clack", "active"],
      ],
    });
    assert.equal(parsed.type, "table");
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0][0], "Repo");
  });

  it("accepts a table with raw_text and rich_text cells", () => {
    const parsed = tableBlockSchema.parse({
      type: "table",
      rows: [
        [
          { type: "raw_text", text: "Plain" },
          {
            type: "rich_text",
            elements: [{ type: "rich_text_section", elements: [] }],
          },
        ],
      ],
    });
    assert.equal(parsed.type, "table");
  });

  it("accepts a table with column_settings", () => {
    const parsed = tableBlockSchema.parse({
      type: "table",
      rows: [["a", "b"]],
      column_settings: [{ align: "left", is_wrapped: false }, { align: "right" }],
    });
    assert.equal(parsed.type, "table");
  });

  it("rejects a table missing rows", () => {
    assert.throws(() => tableBlockSchema.parse({ type: "table" }));
  });

  it("rejects a table with an empty rows array", () => {
    assert.throws(() => tableBlockSchema.parse({ type: "table", rows: [] }));
  });
});

describe("BlockSchema.parse — disallowed block types", () => {
  it("rejects an actions block", () => {
    assert.throws(() => BlockSchema.parse({ type: "actions", elements: [] }));
  });

  it("rejects an input block", () => {
    assert.throws(() => BlockSchema.parse({ type: "input" }));
  });

  it("rejects a top-level rich_text block", () => {
    // rich_text is allowed as a TABLE CELL, but not as a top-level block.
    assert.throws(() => BlockSchema.parse({ type: "rich_text", elements: [] }));
  });

  it("rejects newer AI-surface block types", () => {
    assert.throws(() => BlockSchema.parse({ type: "alert" }));
    assert.throws(() => BlockSchema.parse({ type: "card" }));
    assert.throws(() => BlockSchema.parse({ type: "carousel" }));
  });

  it("rejects an unknown block type", () => {
    assert.throws(() => BlockSchema.parse({ type: "made_up_block_type" }));
  });

  it("emits an actionable error message for an unknown block type", () => {
    // Names the offending type and lists the allowed types so the model can
    // self-correct without hallucinating that the MCP tool is unavailable.
    const result = BlockSchema.safeParse({ type: "made_up_block_type" });
    assert.equal(result.success, false);
    const message = result.success ? "" : result.error.issues[0]?.message;
    assert.match(message, /Block type "made_up_block_type" is not supported/);
    for (const allowed of ALLOWED_BLOCK_TYPES) {
      assert.ok(message.includes(allowed), `error message should list "${allowed}"`);
    }
  });

  it("rejects a markdown block with empty text", () => {
    assert.throws(() => BlockSchema.parse({ type: "markdown", text: "" }));
  });

  it("rejects a markdown block missing text", () => {
    assert.throws(() => BlockSchema.parse({ type: "markdown" }));
  });

  it("rejects a table block in the curated subset (tables are a sibling parameter)", () => {
    // Tables don't belong in `blocks` — Slack always renders them at the bottom
    // of the message, and the API rejects payloads with more than one. The MCP
    // surface exposes them via the standalone `table` parameter on
    // `submit_response` and `post_to`. See `tableBlockSchema` for the
    // standalone validator.
    assert.throws(() => BlockSchema.parse({ type: "table", rows: [["a", "b"]] }));
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
      "markdown",
      "section",
    ]);
  });

  it("does not include actions", () => {
    assert.equal((ALLOWED_BLOCK_TYPES as readonly string[]).includes("actions"), false);
  });

  it("does not include table (tables are a sibling parameter)", () => {
    assert.equal((ALLOWED_BLOCK_TYPES as readonly string[]).includes("table"), false);
  });
});

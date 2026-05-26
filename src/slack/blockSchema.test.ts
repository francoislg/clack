import { describe, it } from "vitest";
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

  it("accepts a minimal card with just a title", () => {
    const parsed = BlockSchema.parse({
      type: "card",
      title: { type: "mrkdwn", text: "Hello" },
    });
    assert.equal(parsed.type, "card");
  });

  it("accepts a card with hero_image, icon, title, subtitle, body", () => {
    const parsed = BlockSchema.parse({
      type: "card",
      hero_image: { type: "image", image_url: "https://example.com/h.png", alt_text: "hero" },
      icon: { type: "image", image_url: "https://example.com/i.png", alt_text: "icon" },
      title: { type: "mrkdwn", text: "PR #42" },
      subtitle: { type: "mrkdwn", text: "Open" },
      body: { type: "mrkdwn", text: "Refactor the worker" },
    });
    assert.equal(parsed.type, "card");
  });

  it("accepts a card carrying an inline actions field at the schema layer (validator rejects it)", () => {
    // The schema is `looseObject` so unknown fields pass through. The v1
    // rejection of card-level actions runs at validation time — see
    // `validateCard` in blockValidate.ts.
    const parsed = BlockSchema.parse({
      type: "card",
      title: { type: "mrkdwn", text: "x" },
      actions: [{ type: "button", text: { type: "plain_text", text: "Go" }, action_id: "x" }],
    });
    assert.equal(parsed.type, "card");
  });

  it("accepts a carousel with 1 child card", () => {
    const parsed = BlockSchema.parse({
      type: "carousel",
      elements: [{ type: "card", title: { type: "mrkdwn", text: "A" } }],
    });
    assert.equal(parsed.type, "carousel");
  });

  it("accepts a carousel with 10 child cards", () => {
    const parsed = BlockSchema.parse({
      type: "carousel",
      elements: Array.from({ length: 10 }, (_, i) => ({
        type: "card" as const,
        title: { type: "mrkdwn" as const, text: `card ${i}` },
      })),
    });
    assert.equal(parsed.type, "carousel");
  });

  it("rejects a carousel with 0 elements at parse time", () => {
    assert.throws(() =>
      BlockSchema.parse({
        type: "carousel",
        elements: [],
      }),
    );
  });

  it("rejects a carousel with 11 elements at parse time", () => {
    assert.throws(() =>
      BlockSchema.parse({
        type: "carousel",
        elements: Array.from({ length: 11 }, () => ({
          type: "card" as const,
          title: { type: "mrkdwn" as const, text: "x" },
        })),
      }),
    );
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

  it("rejects newer AI-surface block types not in the curated subset", () => {
    assert.throws(() => BlockSchema.parse({ type: "alert" }));
    // `card` and `carousel` are in the curated subset — see the dedicated
    // describe block below.
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

  it("emits a table-specific actionable error pointing at the sibling parameter", () => {
    // Why: the generic "not supported / allowed types" message would leave the
    // model guessing where the table object belongs. The table-specific message
    // names the correct location (top-level sibling on submit_response /
    // post_to) so the fix is obvious.
    const result = BlockSchema.safeParse({ type: "table", rows: [["a", "b"]] });
    assert.equal(result.success, false);
    const message = result.success ? "" : result.error.issues[0]?.message;
    assert.match(message, /top-level sibling parameter/);
    assert.match(message, /Move the table object to the `table` field/);
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
      "card",
      "carousel",
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

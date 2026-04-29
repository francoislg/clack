import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BlockSchema, type Block } from "./blockSchema.js";
import { validateBlocks } from "./blockValidate.js";

describe("validateBlocks — totals", () => {
  it("accepts an empty array without total-limit error", () => {
    assert.equal(validateBlocks([]).length, 0);
  });

  it("accepts 50 blocks (at the limit)", () => {
    const blocks: Block[] = Array.from({ length: 50 }, () => ({ type: "divider" }));
    assert.equal(validateBlocks(blocks).length, 0);
  });

  it("rejects 51 blocks (over the limit)", () => {
    const blocks: Block[] = Array.from({ length: 51 }, () => ({ type: "divider" }));
    const errors = validateBlocks(blocks);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks");
    assert.equal(errors[0].currentLength, 51);
    assert.equal(errors[0].limit, 50);
    assert.match(errors[0].message, /Total block count \(51\)/);
  });
});

describe("validateBlocks — header", () => {
  it("accepts a 150-char header (at limit)", () => {
    const block: Block = {
      type: "header",
      text: { type: "plain_text", text: "a".repeat(150) },
    };
    assert.equal(validateBlocks([block]).length, 0);
  });

  it("rejects a 151-char header", () => {
    const block: Block = {
      type: "header",
      text: { type: "plain_text", text: "a".repeat(151) },
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0].text.text");
    assert.equal(errors[0].limit, 150);
    assert.equal(errors[0].currentLength, 151);
  });
});

describe("validateBlocks — context", () => {
  it("accepts 10 elements (at limit)", () => {
    const block: Block = {
      type: "context",
      elements: Array.from({ length: 10 }, () => ({ type: "mrkdwn", text: "x" })),
    };
    assert.equal(validateBlocks([block]).length, 0);
  });

  it("rejects 11 elements", () => {
    const block: Block = {
      type: "context",
      elements: Array.from({ length: 11 }, () => ({ type: "mrkdwn", text: "x" })),
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0].elements");
    assert.equal(errors[0].currentLength, 11);
    assert.equal(errors[0].limit, 10);
  });

  it("rejects context element text over 75 chars", () => {
    const block: Block = {
      type: "context",
      elements: [{ type: "mrkdwn", text: "x".repeat(76) }],
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0].elements[0].text");
    assert.equal(errors[0].limit, 75);
  });

  it("flags multiple over-limit context elements", () => {
    const block: Block = {
      type: "context",
      elements: [
        { type: "mrkdwn", text: "x".repeat(80) },
        { type: "plain_text", text: "y" },
        { type: "mrkdwn", text: "z".repeat(90) },
      ],
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 2);
    assert.equal(errors[0].field, "blocks[0].elements[0].text");
    assert.equal(errors[1].field, "blocks[0].elements[2].text");
  });
});

describe("validateBlocks — section", () => {
  it("accepts a short mrkdwn section", () => {
    const block: Block = {
      type: "section",
      text: { type: "mrkdwn", text: "hello" },
    };
    assert.equal(validateBlocks([block]).length, 0);
  });

  it("rejects section text over 3000 chars", () => {
    const block: Block = {
      type: "section",
      text: { type: "mrkdwn", text: "x".repeat(3001) },
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0].text.text");
    assert.equal(errors[0].limit, 3000);
  });

  it("rejects section with only 1 field (needs at least 2)", () => {
    const block: Block = {
      type: "section",
      fields: [{ type: "mrkdwn", text: "only one" }],
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0].fields");
    assert.equal(errors[0].currentLength, 1);
  });

  it("rejects section with 11 fields (max is 10)", () => {
    const block: Block = {
      type: "section",
      fields: Array.from({ length: 11 }, () => ({ type: "mrkdwn", text: "x" })),
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0].fields");
    assert.equal(errors[0].currentLength, 11);
  });

  it("rejects a field over 2000 chars", () => {
    const block: Block = {
      type: "section",
      fields: [
        { type: "mrkdwn", text: "ok" },
        { type: "mrkdwn", text: "x".repeat(2001) },
      ],
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0].fields[1].text");
    assert.equal(errors[0].limit, 2000);
  });

  it("rejects a section with neither text nor fields", () => {
    const block: Block = { type: "section" };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /must have either/);
  });
});

describe("validateBlocks — image", () => {
  it("accepts valid image with url + alt_text", () => {
    const block: Block = {
      type: "image",
      image_url: "https://example.com/x.png",
      alt_text: "example",
    };
    assert.equal(validateBlocks([block]).length, 0);
  });

  it("rejects image with empty image_url", () => {
    const block: Block = {
      type: "image",
      image_url: "",
      alt_text: "ok",
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0].image_url");
  });

  it("rejects image with empty alt_text", () => {
    const block: Block = {
      type: "image",
      image_url: "https://example.com/x.png",
      alt_text: "",
    };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0].alt_text");
  });

  it("reports both image errors independently", () => {
    const block: Block = { type: "image", image_url: "", alt_text: "" };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 2);
  });

  it("rejects unsupported fields (fallback, image_width, etc.) to avoid Slack's ignored_extra_attributes warning", () => {
    const block = BlockSchema.parse({
      type: "image",
      image_url: "https://example.com/x.png",
      alt_text: "ok",
      fallback: "some fallback",
      image_width: 480,
    });
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "blocks[0]");
    assert.match(errors[0].message, /unsupported field/);
    assert.match(errors[0].message, /fallback/);
    assert.match(errors[0].message, /image_width/);
    assert.match(errors[0].message, /ignored_extra_attributes_for_image_block/);
  });

  it("accepts the allowed optional fields (title, block_id)", () => {
    const block = BlockSchema.parse({
      type: "image",
      image_url: "https://example.com/x.png",
      alt_text: "ok",
      title: { type: "plain_text", text: "caption" },
      block_id: "my-image",
    });
    assert.equal(validateBlocks([block]).length, 0);
  });
});

describe("validateBlocks — divider", () => {
  it("accepts a divider with nothing to validate", () => {
    assert.equal(validateBlocks([{ type: "divider" }]).length, 0);
  });
});

describe("validateBlocks — multi-block ordering", () => {
  it("reports errors in block-index order", () => {
    const blocks: Block[] = [
      { type: "header", text: { type: "plain_text", text: "a".repeat(200) } },
      { type: "section", text: { type: "mrkdwn", text: "ok" } },
      { type: "image", image_url: "", alt_text: "" },
    ];
    const errors = validateBlocks(blocks);
    assert.equal(errors.length, 3);
    assert.match(errors[0].field, /^blocks\[0\]/);
    assert.match(errors[1].field, /^blocks\[2\]/);
    assert.match(errors[2].field, /^blocks\[2\]/);
  });
});

describe("validateBlocks — markdown cumulative cap", () => {
  it("accepts a single small markdown block", () => {
    const block: Block = { type: "markdown", text: "## Hi\n\nshort prose." };
    assert.equal(validateBlocks([block]).length, 0);
  });

  it("accepts cumulative markdown text at exactly 12,000 chars", () => {
    const block: Block = { type: "markdown", text: "a".repeat(12_000) };
    assert.equal(validateBlocks([block]).length, 0);
  });

  it("rejects a single markdown block over 12,000 chars", () => {
    const block: Block = { type: "markdown", text: "a".repeat(12_001) };
    const errors = validateBlocks([block]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].currentLength, 12_001);
    assert.equal(errors[0].limit, 12_000);
    assert.match(errors[0].message, /Cumulative `markdown` block text/);
  });

  it("rejects multiple markdown blocks whose text sums over 12,000 chars", () => {
    const blocks: Block[] = [
      { type: "markdown", text: "a".repeat(7000) },
      { type: "markdown", text: "b".repeat(6000) },
    ];
    const errors = validateBlocks(blocks);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].currentLength, 13_000);
  });

  it("accepts multiple markdown blocks summing exactly to 12,000 chars", () => {
    const blocks: Block[] = [
      { type: "markdown", text: "a".repeat(6000) },
      { type: "markdown", text: "b".repeat(6000) },
    ];
    assert.equal(validateBlocks(blocks).length, 0);
  });
});

describe("validateBlocks — table", () => {
  it("accepts a small table with bare-string cells", () => {
    const block: Block = {
      type: "table",
      rows: [
        ["Repo", "Status"],
        ["clack", "active"],
      ],
    };
    assert.equal(validateBlocks([block]).length, 0);
  });

  it("accepts a table at exactly 100 rows of 20 cells (the boundary)", () => {
    const rows = Array.from({ length: 100 }, () => Array.from({ length: 20 }, () => "x"));
    const block: Block = { type: "table", rows };
    assert.equal(validateBlocks([block]).length, 0);
  });

  it("accepts a table with exactly 20 column_settings (the boundary)", () => {
    const block: Block = {
      type: "table",
      rows: [["a"]],
      column_settings: Array.from({ length: 20 }, () => ({ align: "left" as const })),
    };
    assert.equal(validateBlocks([block]).length, 0);
  });

  it("reports every cell that exceeds the 2,000-char limit", () => {
    const block: Block = {
      type: "table",
      rows: [["a".repeat(2001), "b".repeat(2001)]],
    };
    const errors = validateBlocks([block]);
    const cellErrors = errors.filter((e) => /^blocks\[0\]\.rows\[0\]\[\d+\]$/.test(e.field));
    assert.equal(cellErrors.length, 2);
  });

  it("rejects a table with more than 100 rows", () => {
    const rows = Array.from({ length: 101 }, (_, i) => [`row${i}`]);
    const block: Block = { type: "table", rows };
    const errors = validateBlocks([block]);
    const rowError = errors.find((e) => e.field === "blocks[0].rows");
    assert.ok(rowError);
    assert.equal(rowError.currentLength, 101);
    assert.equal(rowError.limit, 100);
  });

  it("rejects a row with more than 20 cells", () => {
    const block: Block = {
      type: "table",
      rows: [Array.from({ length: 21 }, (_, i) => `c${i}`)],
    };
    const errors = validateBlocks([block]);
    const cellError = errors.find((e) => e.field === "blocks[0].rows[0]");
    assert.ok(cellError);
    assert.equal(cellError.currentLength, 21);
    assert.equal(cellError.limit, 20);
  });

  it("rejects column_settings with more than 20 entries", () => {
    const block: Block = {
      type: "table",
      rows: [["a"]],
      column_settings: Array.from({ length: 21 }, () => ({ align: "left" as const })),
    };
    const errors = validateBlocks([block]);
    const csError = errors.find((e) => e.field === "blocks[0].column_settings");
    assert.ok(csError);
    assert.equal(csError.currentLength, 21);
  });

  it("rejects a string cell exceeding 2,000 chars", () => {
    const block: Block = {
      type: "table",
      rows: [["short", "a".repeat(2001)]],
    };
    const errors = validateBlocks([block]);
    const cellError = errors.find((e) => e.field === "blocks[0].rows[0][1]");
    assert.ok(cellError);
    assert.equal(cellError.currentLength, 2001);
    assert.equal(cellError.limit, 2000);
  });

  it("rejects a raw_text cell exceeding 2,000 chars", () => {
    const block: Block = {
      type: "table",
      rows: [[{ type: "raw_text", text: "a".repeat(2001) }]],
    };
    const errors = validateBlocks([block]);
    const cellError = errors.find((e) => e.field === "blocks[0].rows[0][0]");
    assert.ok(cellError);
    assert.equal(cellError.currentLength, 2001);
  });

  it("does NOT enforce per-cell cap on rich_text cells (text length not measured)", () => {
    const block: Block = {
      type: "table",
      rows: [
        [
          {
            type: "rich_text",
            elements: [{ type: "rich_text_section" }],
          },
        ],
      ],
    };
    // Validation passes — we don't walk rich_text element trees.
    const errors = validateBlocks([block]);
    assert.equal(
      errors.filter((e) => /rows\[0\]\[0\]/.test(e.field)).length,
      0,
      "should not flag oversize rich_text cells",
    );
  });
});

describe("validateBlocks — multi-table guard", () => {
  it("rejects a payload containing two table blocks", () => {
    const blocks: Block[] = [
      { type: "table", rows: [["a"]] },
      { type: "section", text: { type: "mrkdwn", text: "between" } },
      { type: "table", rows: [["b"]] },
    ];
    const errors = validateBlocks(blocks);
    const multiTableError = errors.find((e) => /at most one `table` block/.test(e.message));
    assert.ok(multiTableError);
    assert.equal(multiTableError.currentLength, 2);
    assert.equal(multiTableError.limit, 1);
    assert.match(multiTableError.message, /indices \[0, 2\]/);
  });

  it("accepts a payload with exactly one table", () => {
    const blocks: Block[] = [
      { type: "section", text: { type: "mrkdwn", text: "header" } },
      { type: "table", rows: [["a", "b"]] },
    ];
    assert.equal(validateBlocks(blocks).length, 0);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Block } from "./blockSchema.js";
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

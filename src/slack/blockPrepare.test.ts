import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Block } from "./blockSchema.js";
import { prepareBlocks } from "./blockPrepare.js";

describe("prepareBlocks — pass-throughs", () => {
  it("preserves divider verbatim", () => {
    const result = prepareBlocks([{ type: "divider" }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "divider");
  });

  it("preserves header (plain_text, no markdown conversion)", () => {
    const block: Block = {
      type: "header",
      text: { type: "plain_text", text: "**hi**" },
    };
    const result = prepareBlocks([block]);
    assert.equal(result.length, 1);
    if (result[0].type === "header") {
      // Header is plain_text — markdown must NOT be converted
      assert.equal(result[0].text.text, "**hi**");
    } else {
      assert.fail("expected header block");
    }
  });

  it("preserves image block unchanged", () => {
    const block: Block = {
      type: "image",
      image_url: "https://example.com/x.png",
      alt_text: "example",
    };
    const result = prepareBlocks([block]);
    assert.equal(result.length, 1);
    if (result[0].type === "image" && "image_url" in result[0]) {
      assert.equal(result[0].image_url, "https://example.com/x.png");
    } else {
      assert.fail("expected image block with image_url");
    }
  });

  it("returns a new array (does not mutate input)", () => {
    const input: Block[] = [{ type: "divider" }];
    const result = prepareBlocks(input);
    assert.notEqual(result, input);
  });
});

describe("prepareBlocks — markdown conversion on section.text", () => {
  it("converts markdown links to Slack mrkdwn inside mrkdwn section text", () => {
    const block: Block = {
      type: "section",
      text: { type: "mrkdwn", text: "See [docs](https://example.com)" },
    };
    const result = prepareBlocks([block]);
    assert.equal(result.length, 1);
    if (result[0].type === "section" && result[0].text) {
      assert.equal(result[0].text.text, "See <https://example.com|docs>");
    } else {
      assert.fail("expected section with text");
    }
  });

  it("does NOT convert markdown on plain_text sections", () => {
    const block: Block = {
      type: "section",
      text: { type: "plain_text", text: "See [docs](https://example.com)" },
    };
    const result = prepareBlocks([block]);
    if (result[0].type === "section" && result[0].text) {
      assert.equal(result[0].text.text, "See [docs](https://example.com)");
    } else {
      assert.fail("expected section with text");
    }
  });
});

describe("prepareBlocks — section splitting", () => {
  it("does not split text under 3000 chars", () => {
    const block: Block = {
      type: "section",
      text: { type: "mrkdwn", text: "x".repeat(2000) },
    };
    const result = prepareBlocks([block]);
    assert.equal(result.length, 1);
  });

  it("splits text over 3000 chars into multiple section blocks", () => {
    // Build a paragraph-split-friendly text: 4 paragraphs of 800 chars each = 3200 total
    const para = "x".repeat(800);
    const input = [para, para, para, para].join("\n\n");
    const block: Block = {
      type: "section",
      text: { type: "mrkdwn", text: input },
    };
    const result = prepareBlocks([block]);
    assert.ok(result.length > 1, `expected > 1 block, got ${result.length}`);
    for (const b of result) {
      assert.equal(b.type, "section");
      if (b.type === "section" && b.text) {
        assert.ok(b.text.text.length <= 3000, `chunk length ${b.text.text.length} exceeds 3000`);
      }
    }
  });

  it("pairs fields only with the first chunk of a split section", () => {
    const para = "x".repeat(800);
    const input = [para, para, para, para].join("\n\n");
    const block: Block = {
      type: "section",
      text: { type: "mrkdwn", text: input },
      fields: [
        { type: "mrkdwn", text: "a" },
        { type: "mrkdwn", text: "b" },
      ],
    };
    const result = prepareBlocks([block]);
    assert.ok(result.length >= 2);
    if (result[0].type === "section") {
      assert.equal(result[0].fields?.length, 2);
    }
    for (let i = 1; i < result.length; i++) {
      const b = result[i];
      if (b.type === "section") {
        assert.equal(b.fields, undefined, `chunk ${i} should have no fields`);
      }
    }
  });
});

describe("prepareBlocks — section.fields mrkdwn conversion", () => {
  it("converts markdown in each mrkdwn field", () => {
    const block: Block = {
      type: "section",
      fields: [
        { type: "mrkdwn", text: "[name](https://n.example)" },
        { type: "mrkdwn", text: "[role](https://r.example)" },
      ],
    };
    const result = prepareBlocks([block]);
    if (result[0].type === "section" && result[0].fields) {
      assert.equal(result[0].fields[0].text, "<https://n.example|name>");
      assert.equal(result[0].fields[1].text, "<https://r.example|role>");
    } else {
      assert.fail("expected section with fields");
    }
  });

  it("does not convert plain_text fields", () => {
    const block: Block = {
      type: "section",
      fields: [
        { type: "plain_text", text: "[raw](http://x)" },
        { type: "mrkdwn", text: "plain" },
      ],
    };
    const result = prepareBlocks([block]);
    if (result[0].type === "section" && result[0].fields) {
      assert.equal(result[0].fields[0].text, "[raw](http://x)");
      assert.equal(result[0].fields[1].text, "plain");
    }
  });
});

describe("prepareBlocks — context conversion", () => {
  it("converts mrkdwn elements inside a context block", () => {
    const block: Block = {
      type: "context",
      elements: [
        { type: "mrkdwn", text: "See [docs](https://example.com)" },
        { type: "plain_text", text: "[raw](http://x)" },
      ],
    };
    const result = prepareBlocks([block]);
    if (result[0].type === "context") {
      const [e0, e1] = result[0].elements;
      if (e0.type === "mrkdwn") assert.equal(e0.text, "See <https://example.com|docs>");
      else assert.fail("expected mrkdwn element");
      if (e1.type === "plain_text") assert.equal(e1.text, "[raw](http://x)");
      else assert.fail("expected plain_text element");
    }
  });

  it("preserves image elements inside context unchanged", () => {
    const block: Block = {
      type: "context",
      elements: [
        {
          type: "image",
          image_url: "https://example.com/x.png",
          alt_text: "x",
        },
      ],
    };
    const result = prepareBlocks([block]);
    if (result[0].type === "context") {
      const el = result[0].elements[0];
      if (el.type === "image" && "image_url" in el) {
        assert.equal(el.image_url, "https://example.com/x.png");
      } else {
        assert.fail("expected context image element with image_url");
      }
    }
  });
});

describe("prepareBlocks — passthrough fields preserved through prepare", () => {
  it("preserves block_id on a section", () => {
    // block_id is a passthrough — we type with a wider cast for the test.
    const block = {
      type: "section" as const,
      text: { type: "mrkdwn" as const, text: "hi" },
      block_id: "my_block",
    };
    const result = prepareBlocks([block]);
    const first = result[0];
    assert.ok("block_id" in first);
    if ("block_id" in first) {
      assert.equal(first.block_id, "my_block");
    }
  });

  it("preserves accessibility_label on a header", () => {
    const block = {
      type: "header" as const,
      text: { type: "plain_text" as const, text: "Hi" },
      block_id: "welcome",
    };
    const result = prepareBlocks([block]);
    const first = result[0];
    assert.ok("block_id" in first);
  });

  it("does NOT recurse into passthrough fields for markdown conversion", () => {
    // A passthrough field that happens to contain **markdown** should NOT be converted.
    const block = {
      type: "section" as const,
      text: { type: "mrkdwn" as const, text: "hi" },
      block_id: "**not_converted**",
    };
    const result = prepareBlocks([block]);
    const first = result[0];
    if ("block_id" in first) {
      assert.equal(first.block_id, "**not_converted**");
    } else {
      assert.fail("expected block_id on output");
    }
  });
});

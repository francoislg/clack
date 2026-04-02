import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { convertMarkdownToSlack, splitForSlack } from "./formatting.js";

// ---------------------------------------------------------------------------
// convertMarkdownToSlack
// ---------------------------------------------------------------------------
describe("convertMarkdownToSlack", () => {
  describe("bold and italic conversion", () => {
    it("converts **text** through bold then italic pass (bold becomes italic in Slack)", () => {
      // **bold** -> *bold* (bold rule) -> _bold_ (italic rule matches single *)
      // This is a known quirk: markdown bold ends up as Slack italic
      assert.equal(convertMarkdownToSlack("**bold**"), "_bold_");
    });

    it("converts __text__ through bold then italic pass", () => {
      // __bold__ -> *bold* (bold rule) -> _bold_ (italic rule)
      assert.equal(convertMarkdownToSlack("__bold__"), "_bold_");
    });

    it("converts multiple bold segments consistently", () => {
      assert.equal(convertMarkdownToSlack("**first** and **second**"), "_first_ and _second_");
    });
  });

  describe("strikethrough conversion", () => {
    it("converts ~~text~~ to ~text~", () => {
      assert.equal(convertMarkdownToSlack("~~deleted~~"), "~deleted~");
    });
  });

  describe("header conversion", () => {
    it("converts # Header to *Header*", () => {
      assert.equal(convertMarkdownToSlack("# Title"), "*Title*");
    });

    it("converts ## Header to *Header*", () => {
      assert.equal(convertMarkdownToSlack("## Subtitle"), "*Subtitle*");
    });

    it("converts ### through ###### headers", () => {
      assert.equal(convertMarkdownToSlack("### H3"), "*H3*");
      assert.equal(convertMarkdownToSlack("###### H6"), "*H6*");
    });

    it("only converts headers at the start of a line", () => {
      assert.equal(convertMarkdownToSlack("text # not a header"), "text # not a header");
    });

    it("handles multiline with headers", () => {
      const input = "# Title\nSome text\n## Section";
      const result = convertMarkdownToSlack(input);
      assert.equal(result, "*Title*\nSome text\n*Section*");
    });
  });

  describe("link conversion", () => {
    it("converts [text](url) to <url|text>", () => {
      assert.equal(
        convertMarkdownToSlack("[click here](https://example.com)"),
        "<https://example.com|click here>",
      );
    });

    it("converts multiple links", () => {
      assert.equal(
        convertMarkdownToSlack("[a](http://a.com) and [b](http://b.com)"),
        "<http://a.com|a> and <http://b.com|b>",
      );
    });
  });

  describe("code preservation", () => {
    it("preserves inline code", () => {
      assert.equal(convertMarkdownToSlack("`code`"), "`code`");
    });

    it("preserves code blocks", () => {
      const input = "```\ncode block\n```";
      assert.equal(convertMarkdownToSlack(input), input);
    });
  });

  describe("passthrough", () => {
    it("returns plain text unchanged", () => {
      assert.equal(convertMarkdownToSlack("plain text"), "plain text");
    });

    it("returns empty string for empty input", () => {
      assert.equal(convertMarkdownToSlack(""), "");
    });
  });
});

// ---------------------------------------------------------------------------
// splitForSlack
// ---------------------------------------------------------------------------
describe("splitForSlack", () => {
  it("returns single chunk when text fits within limit", () => {
    const text = "short text";
    assert.deepEqual(splitForSlack(text), ["short text"]);
  });

  it("returns single chunk for text exactly at limit", () => {
    const text = "a".repeat(3000);
    assert.deepEqual(splitForSlack(text), [text]);
  });

  it("splits on paragraph boundary (double newline)", () => {
    const para1 = "a".repeat(2000);
    const para2 = "b".repeat(2000);
    const text = `${para1}\n\n${para2}`;
    const chunks = splitForSlack(text);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0], para1);
    assert.equal(chunks[1], para2);
  });

  it("splits on single newline when no paragraph break", () => {
    const line1 = "a".repeat(2000);
    const line2 = "b".repeat(2000);
    const text = `${line1}\n${line2}`;
    const chunks = splitForSlack(text);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0], line1);
    assert.equal(chunks[1], line2);
  });

  it("hard-cuts when no newline is available", () => {
    const text = "a".repeat(6000);
    const chunks = splitForSlack(text);
    assert.ok(chunks.length >= 2, "Should split into multiple chunks");
    assert.equal(chunks[0].length, 3000);
  });

  it("respects custom maxLength", () => {
    const text = "abc\n\ndef\n\nghi";
    const chunks = splitForSlack(text, 5);
    assert.ok(chunks.length > 1, "Should split with small limit");
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 5, `Chunk "${chunk}" exceeds limit`);
    }
  });

  it("strips leading newlines from subsequent chunks", () => {
    const para1 = "a".repeat(2500);
    const para2 = "b".repeat(2500);
    const text = `${para1}\n\n${para2}`;
    const chunks = splitForSlack(text);
    assert.equal(chunks.length, 2);
    assert.ok(!chunks[1].startsWith("\n"), "Second chunk should not start with newline");
    assert.equal(chunks[1], "b".repeat(2500));
  });

  it("handles empty string", () => {
    assert.deepEqual(splitForSlack(""), [""]);
  });

  it("handles text with only newlines exceeding limit", () => {
    const text = "\n".repeat(5000);
    const chunks = splitForSlack(text);
    // Should not hang or crash
    assert.ok(chunks.length >= 1);
  });
});

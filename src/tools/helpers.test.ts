import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { textResult, errorResult, looksLikeSlackId } from "./helpers.js";

describe("looksLikeSlackId", () => {
  it("accepts public/private channel IDs (C prefix)", () => {
    assert.equal(looksLikeSlackId("C0123ABCDEF"), true);
  });

  it("accepts legacy group DM IDs (G prefix)", () => {
    assert.equal(looksLikeSlackId("G0123ABCDEF"), true);
  });

  it("accepts DM channel IDs (D prefix)", () => {
    assert.equal(looksLikeSlackId("D0123ABCDEF"), true);
  });

  it("accepts user IDs (U prefix)", () => {
    assert.equal(looksLikeSlackId("U0123ABCDEF"), true);
  });

  it("rejects plain channel names", () => {
    assert.equal(looksLikeSlackId("general"), false);
    assert.equal(looksLikeSlackId("#general"), false);
  });

  it("rejects lowercase IDs", () => {
    assert.equal(looksLikeSlackId("c0123abcdef"), false);
  });

  it("rejects IDs with unsupported prefixes", () => {
    assert.equal(looksLikeSlackId("X0123ABCDEF"), false);
    assert.equal(looksLikeSlackId("B0123ABCDEF"), false);
  });

  it("rejects empty string", () => {
    assert.equal(looksLikeSlackId(""), false);
  });

  it("rejects single-character prefix only", () => {
    assert.equal(looksLikeSlackId("C"), false);
  });
});

describe("textResult", () => {
  it("serializes an object to JSON", () => {
    const result = textResult({ key: "value", count: 3 });
    assert.deepEqual(result, {
      content: [{ type: "text", text: JSON.stringify({ key: "value", count: 3 }, null, 2) }],
    });
  });

  it("serializes a string to JSON", () => {
    const result = textResult("hello");
    assert.deepEqual(result, {
      content: [{ type: "text", text: '"hello"' }],
    });
  });

  it("serializes an array to JSON", () => {
    const result = textResult([1, 2, 3]);
    assert.deepEqual(result, {
      content: [{ type: "text", text: JSON.stringify([1, 2, 3], null, 2) }],
    });
  });

  it("serializes null to JSON", () => {
    const result = textResult(null);
    assert.deepEqual(result, {
      content: [{ type: "text", text: "null" }],
    });
  });
});

describe("errorResult", () => {
  it("wraps the message in an error envelope with isError flag", () => {
    const result = errorResult("something went wrong");
    assert.deepEqual(result, {
      content: [{ type: "text", text: JSON.stringify({ error: "something went wrong" }) }],
      isError: true,
    });
  });

  it("handles empty string message", () => {
    const result = errorResult("");
    assert.deepEqual(result, {
      content: [{ type: "text", text: JSON.stringify({ error: "" }) }],
      isError: true,
    });
  });
});

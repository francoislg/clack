import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { textResult, errorResult } from "./helpers.js";

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

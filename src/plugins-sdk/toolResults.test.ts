import { describe, it, expect } from "vitest";
import { MAX_TOOL_OUTPUT_CHARS, textResult, errorResult } from "./toolResults.js";

describe("textResult", () => {
  it("wraps data as a pretty-printed JSON text block", () => {
    const result = textResult({ ok: true, count: 2 });
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ ok: true, count: 2 }, null, 2) }],
    });
  });

  it("does not set isError", () => {
    expect("isError" in textResult({})).toBe(false);
  });
});

describe("errorResult", () => {
  it("wraps the message in an error envelope with isError", () => {
    const result = errorResult("boom");
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: "boom" }) }],
      isError: true,
    });
  });
});

describe("MAX_TOOL_OUTPUT_CHARS", () => {
  it("stays under the Agent SDK tool-result cap", () => {
    expect(MAX_TOOL_OUTPUT_CHARS).toBe(40_000);
  });
});

import { describe, it, expect } from "vitest";
import { toolResultText, parseToolResult } from "./testHelpers.js";
import { textResult, errorResult } from "./toolResults.js";

describe("toolResultText", () => {
  it("returns the first text block's text", () => {
    expect(toolResultText(textResult({ ok: true }))).toBe(JSON.stringify({ ok: true }, null, 2));
  });

  it("throws on an empty content array", () => {
    expect(() => toolResultText({ content: [] })).toThrow("expected text content, got none");
  });

  it("throws on a non-text block", () => {
    expect(() => toolResultText({ content: [{ type: "image" }] })).toThrow(
      "expected text content, got image",
    );
  });

  it("throws when a text block carries a non-string text value", () => {
    expect(() => toolResultText({ content: [{ type: "text", text: 123 }] })).toThrow(
      "expected text content",
    );
  });
});

describe("parseToolResult", () => {
  it("parses textResult envelopes", () => {
    expect(parseToolResult(textResult({ count: 2 }))).toEqual({ count: 2 });
  });

  it("parses errorResult envelopes", () => {
    expect(parseToolResult(errorResult("boom"))).toEqual({ error: "boom" });
  });
});

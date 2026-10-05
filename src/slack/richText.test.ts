import { describe, expect, it } from "vitest";
import { toRichText } from "./richText.js";

describe("toRichText", () => {
  it("wraps plain text in one rich_text section", () => {
    expect(toRichText("hello")).toEqual({
      type: "rich_text",
      elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "hello" }] }],
    });
  });
});

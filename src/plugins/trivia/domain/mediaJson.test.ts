import { describe, it, expect } from "vitest";
import { mediaToJson } from "./mediaJson.js";
import type { QuestionMedia } from "../core/types.js";

describe("mediaToJson", () => {
  const base: QuestionMedia = {
    kind: "image",
    url: "https://example.com/x.jpg",
    altText: "a landmark",
    subjectId: "wikidata:Q243",
    title: "Eiffel Tower",
  };

  it("projects the required fields", () => {
    expect(mediaToJson(base)).toEqual({
      kind: "image",
      url: "https://example.com/x.jpg",
      altText: "a landmark",
      subjectId: "wikidata:Q243",
      title: "Eiffel Tower",
    });
  });

  it("includes license and attribution when present", () => {
    const result = mediaToJson({ ...base, license: "CC-BY-SA 4.0", attribution: "Jane Doe" });
    expect(result).toEqual({
      kind: "image",
      url: "https://example.com/x.jpg",
      altText: "a landmark",
      subjectId: "wikidata:Q243",
      title: "Eiffel Tower",
      license: "CC-BY-SA 4.0",
      attribution: "Jane Doe",
    });
  });

  it("omits license and attribution when absent (no undefined keys)", () => {
    const result = mediaToJson(base);
    expect(result).not.toHaveProperty("license");
    expect(result).not.toHaveProperty("attribution");
  });
});

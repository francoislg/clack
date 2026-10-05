import { describe, it, expect } from "vitest";
import { parseBaseline, serializeBaseline, withAgreement } from "./baseline.js";

describe("parseBaseline", () => {
  it("reads an absent file as an empty baseline without a warning", () => {
    expect(parseBaseline(undefined)).toEqual({ baseline: new Map() });
  });

  it("reads the files map", () => {
    const { baseline, warning } = parseBaseline('{"files":{"data/config.json":"abc"}}');
    expect(warning).toBeUndefined();
    expect(baseline).toEqual(new Map([["data/config.json", "abc"]]));
  });

  it("reads invalid JSON as empty, with a warning", () => {
    expect(parseBaseline("{nope")).toEqual({
      baseline: new Map(),
      warning: "baseline is not valid JSON — treating as empty",
    });
  });

  it("reads a mis-shaped file as empty, with a warning", () => {
    expect(parseBaseline('{"files":{"a":1}}')).toEqual({
      baseline: new Map(),
      warning: "baseline has an unexpected shape — treating as empty",
    });
  });
});

describe("serializeBaseline", () => {
  it("writes sorted paths that parse back to the same map", () => {
    const baseline = new Map([
      ["data/mcp.json", "2"],
      ["data/config.json", "1"],
    ]);
    const text = serializeBaseline(baseline);
    expect(text.indexOf("data/config.json")).toBeLessThan(text.indexOf("data/mcp.json"));
    expect(parseBaseline(text).baseline).toEqual(baseline);
  });
});

describe("withAgreement", () => {
  it("overrides agreed paths and keeps the rest", () => {
    const merged = withAgreement(
      new Map([
        ["a", "1"],
        ["b", "1"],
      ]),
      new Map([["b", "2"]]),
    );
    expect(merged).toEqual(
      new Map([
        ["a", "1"],
        ["b", "2"],
      ]),
    );
  });
});

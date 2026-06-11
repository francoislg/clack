import { describe, it, expect } from "vitest";
import { DEFAULT_MODEL_MAP, parseModelMap, resolveModel } from "./models.js";

describe("parseModelMap", () => {
  it("returns defaults for null/empty input", () => {
    expect(parseModelMap(null)).toEqual(DEFAULT_MODEL_MAP);
    expect(parseModelMap("  ")).toEqual(DEFAULT_MODEL_MAP);
  });

  it("merges a partial override over the defaults", () => {
    const map = parseModelMap(JSON.stringify({ best: "custom-best" }));
    expect(map.best).toBe("custom-best");
    expect(map.fast).toBe(DEFAULT_MODEL_MAP.fast);
    expect(map.edit).toBe(DEFAULT_MODEL_MAP.edit);
  });

  it("falls back to defaults on invalid JSON (graceful reader)", () => {
    expect(parseModelMap("{not json")).toEqual(DEFAULT_MODEL_MAP);
  });

  it("falls back to defaults when a field has the wrong type", () => {
    expect(parseModelMap(JSON.stringify({ fast: 123 }))).toEqual(DEFAULT_MODEL_MAP);
  });
});

describe("resolveModel", () => {
  it("maps the quality tier", () => {
    expect(resolveModel(DEFAULT_MODEL_MAP, "fast")).toBe(DEFAULT_MODEL_MAP.fast);
    expect(resolveModel(DEFAULT_MODEL_MAP, "best")).toBe(DEFAULT_MODEL_MAP.best);
  });

  it("selects the edit model regardless of tier when editing", () => {
    expect(resolveModel(DEFAULT_MODEL_MAP, "best", { edit: true })).toBe(DEFAULT_MODEL_MAP.edit);
  });
});

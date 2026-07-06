import { describe, it, expect } from "vitest";
import { DEFAULT_FETCH_INSTRUCTIONS } from "./fetchInstructions.js";

describe("DEFAULT_FETCH_INSTRUCTIONS", () => {
  it("points own-PR review detection at the shipped PR-handling contract", () => {
    expect(DEFAULT_FETCH_INSTRUCTIONS).toContain("PR-handling contract (canonical review check)");
    expect(DEFAULT_FETCH_INSTRUCTIONS).toContain("overrides");
    expect(DEFAULT_FETCH_INSTRUCTIONS).toContain("`howToRead` for PR references");
  });
});

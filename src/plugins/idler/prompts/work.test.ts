import { describe, it, expect } from "vitest";
import { buildWorkPrompt } from "./work.js";
import { DEFAULT_CONFIG } from "../config.js";

describe("buildWorkPrompt", () => {
  it("points PR references at the PR-handling contract when re-reading references", () => {
    const prompt = buildWorkPrompt(DEFAULT_CONFIG, "fetch");
    expect(prompt).toContain("Re-read its references (their howToRead) before committing");
    expect(prompt).toContain(
      "PR references follow the PR-handling contract (canonical review check)",
    );
  });
});

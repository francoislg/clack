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

  it("does the cheap-first freshness check and empty-outcome skip before attaching integrations", () => {
    const prompt = buildWorkPrompt(DEFAULT_CONFIG, "fetch");
    expect(prompt).toContain("CHEAP-FIRST FRESHNESS CHECK");
    expect(prompt).toContain("before any attach_integration");
    expect(prompt).toContain('record_fire_outcome({ outcome: "empty" })');
    expect(prompt).toContain("skip_response: true");
    expect(prompt).toContain("Attach integrations LAZILY");
    expect(prompt).toContain("do NOT fall through to another unit with a second deep read");
  });

  it("wires the night circuit breaker: tripped early-exit and async-triggered recording", () => {
    const prompt = buildWorkPrompt(DEFAULT_CONFIG, "fetch");
    expect(prompt).toContain("nightBreaker.tripped: true");
    expect(prompt).toContain('record_fire_outcome({ outcome: "async-triggered"');
  });
});

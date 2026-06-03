import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildPrompt } from "./prompt.js";

describe("casual-talk prompt", () => {
  it("includes the resolved die size and rate label", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C123"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("daily (1/28)"));
    assert.ok(prompt.includes("max: 28"));
  });

  it("includes each channel id (bare-string form)", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111", "C222", "C333"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("C111"));
    assert.ok(prompt.includes("C222"));
    assert.ok(prompt.includes("C333"));
  });

  it("includes promptSuggestion when present (object form)", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111", { id: "C222", promptSuggestion: "memes only — keep it visual" }],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("C111"));
    assert.ok(prompt.includes("C222"));
    assert.ok(prompt.includes("memes only — keep it visual"));
  });

  it("includes each small-talk topic", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food", "weekend plans", "pop culture"],
    });
    assert.ok(prompt.includes("food"));
    assert.ok(prompt.includes("weekend plans"));
    assert.ok(prompt.includes("pop culture"));
  });

  it("explicitly tells Claude delivery is via post_to and submit_response is terminator-only", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    // Must mention post_to as the delivery path
    assert.ok(prompt.includes("post_to"));
    // Must explicitly state submit_response cannot deliver text
    assert.ok(
      prompt.includes("CANNOT deliver text via `submit_response`") ||
        prompt.includes("CANNOT deliver text via submit_response"),
    );
    // Must mention the skipped-shape rule
    assert.ok(prompt.includes("{ skip_response: true }"));
  });

  it("instructs Claude to never reveal the trigger mechanism", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(
      prompt.toLowerCase().includes("never reveal") || prompt.toLowerCase().includes("automation"),
    );
  });

  it("instructs Claude to fetch with include_threads so thread activity is visible", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("include_threads: true"));
    assert.ok(prompt.includes("reply_count"));
  });

  it("instructs Claude that thread_ts on post_to is the way to chip into a thread", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("thread_ts"));
  });

  it("handles empty channels list gracefully (no crash)", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: [],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("(no channels configured)"));
  });

  it("handles empty topics list gracefully (no crash)", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("(no fallback topics configured)"));
  });

  it("frames a hit as a commitment to post (decides where/what, not whether)", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("WHERE and WHAT"));
    assert.ok(prompt.toLowerCase().includes("not whether"));
  });

  it("with topics, the fresh opener is the default and skipping a hit is rare", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food", "weekend plans"],
    });
    // Fresh opener is presented as the default, not an afterthought
    assert.ok(prompt.includes("DEFAULT when no channel has an active conversation"));
    // Step 4 narrows skipping to genuine impossibility
    assert.ok(prompt.includes("Skipping a hit is RARE"));
    assert.ok(prompt.includes("genuinely impossible"));
    // The old easy-out wording must be gone
    assert.ok(!prompt.includes("decided not to post"));
  });

  it("without topics, the run is chip-in-only and a quiet day legitimately skips", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("chip into already-active conversations"));
    assert.ok(prompt.includes("expected outcome in this configuration"));
    // The "rare skip" framing only applies when fresh openers are possible
    assert.ok(!prompt.includes("Skipping a hit is RARE"));
  });
});

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildPrompt } from "./prompt.js";

describe("casual-talk lean triggering prompt", () => {
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

  it("directs a miss to skip immediately without attaching anything", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("If the roll is NOT exactly 1"));
    assert.ok(prompt.includes("submit_response({ skip_response: true })"));
    assert.ok(prompt.includes("do NOT attach anything"));
  });

  it("directs a hit to attach engagement + response-rendering right under the roll", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes('attach_integration("casual-talk:engagement")'));
    assert.ok(prompt.includes('attach_integration("response-rendering")'));
    assert.ok(prompt.includes("BEFORE anything else"));
    // The directive sits inside Step 1 — before the config blocks, not buried at the end.
    const directiveIdx = prompt.indexOf("casual-talk:engagement");
    const channelsIdx = prompt.indexOf("## Candidate channels");
    assert.ok(directiveIdx < channelsIdx);
  });

  it("treats a failed attach as a degraded hit, never a skip", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("a failed attach is a degraded hit, never a reason to skip"));
  });

  it("is lean — restates none of the engagement mechanics", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(!prompt.includes("fetch_channel_messages"));
    assert.ok(!prompt.includes("last_reply"));
    assert.ok(!prompt.includes("add_reaction"));
    assert.ok(!prompt.includes("find_emoji"));
    assert.ok(!prompt.includes('attention_level: "high"'));
    assert.ok(!prompt.includes("default_delivery_mode"));
    assert.ok(!prompt.includes("React-only"));
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

  it("with topics, skipping a hit is rare (genuine impossibility only)", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food", "weekend plans"],
    });
    assert.ok(prompt.includes("skipping a hit is RARE"));
    assert.ok(prompt.includes("genuinely impossible"));
    assert.ok(prompt.includes("is NOT impossibility"));
  });

  it("without topics, the run is chip-in-only and a quiet day legitimately skips", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("chip-in-only"));
    assert.ok(prompt.includes("chip into already-active conversations"));
    assert.ok(prompt.includes("expected outcome in this configuration"));
    assert.ok(!prompt.includes("skipping a hit is RARE"));
  });

  it("instructs Claude to never reveal the trigger mechanism", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes("NEVER reveal"));
    assert.ok(prompt.toLowerCase().includes("automation"));
  });
});

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

  it("tells Claude to deliver via a deliver_to entry and NOT to also set skip_response", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    // Delivery is a submit_response call carrying a single deliver_to entry.
    assert.ok(prompt.includes("deliver_to"));
    assert.ok(prompt.includes("deliver_to` array holding exactly ONE entry"));
    // Delivery must NOT go through a post_to action anymore.
    assert.ok(!prompt.includes("post_to"));
    // Must warn against combining skip_response with the delivering call (the dropped-post bug).
    assert.ok(prompt.includes("Do NOT also set `skip_response` when you are delivering"));
    // Skip shape still documented for the no-post cases.
    assert.ok(prompt.includes("{ skip_response: true }"));
  });

  it("instructs Claude to set attention_level: high so casual threads stay conversational", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes('attention_level: "high"'));
    assert.match(prompt, /`attention_level: "high"` is MANDATORY/);
    // The rationale must cite the invisible-schedule constraint (no second chance to engage).
    assert.match(prompt, /INVISIBLE scheduled tick/);
  });

  it("instructs Claude to set default_delivery_mode: invisible so casual replies feel natural", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: [],
    });
    assert.ok(prompt.includes('default_delivery_mode: "invisible"'));
    assert.match(prompt, /`default_delivery_mode: "invisible"` is MANDATORY/);
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

  it("instructs Claude that thread_ts on a deliver_to entry is the way to chip into a thread", () => {
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

  it("frames a hit as a commitment to engage (decides where/how, not whether)", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("WHERE and HOW"));
    assert.ok(prompt.toLowerCase().includes("not whether"));
  });

  it("offers reaction as a non-exclusive on-hit move alongside posting", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("three NON-EXCLUSIVE positive moves"));
    assert.ok(prompt.includes("**react**"));
    assert.ok(prompt.includes("**post**"));
    assert.ok(prompt.includes("**both**"));
  });

  it("gives reactions a looser bar than posting and reuses the human-leaf guard", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("Reacting is more open than posting"));
    assert.ok(prompt.includes("REACTABLE"));
    // Human-leaf guard reused for reactions (no pile-on on bots / own posts)
    assert.ok(prompt.includes("only react to a message whose LATEST content is from a human"));
    assert.ok(prompt.includes("Never react to a bot-leaf message"));
  });

  it("instructs find_emoji before reacting and calibrates to channel character", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("call `find_emoji`"));
    assert.ok(prompt.includes("fall back to a standard emoji"));
    // Calibration sources: hint, channel_name, channel_purpose
    assert.ok(prompt.includes("`channel_name`"));
    assert.ok(prompt.includes("`channel_purpose`"));
    // Reaction is added via add_reaction
    assert.ok(prompt.includes("`add_reaction`"));
  });

  it("caps reaction volume by judgment with no fixed numeric cap", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("ONE or TWO messages"));
    assert.ok(prompt.includes("don't blanket the channel"));
    assert.ok(prompt.includes("no fixed cap"));
  });

  it("documents react-only and react-and-post termination paths", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    // React-only: add_reaction then skip_response, no deliver_to
    assert.ok(prompt.includes("**React-only**"));
    assert.ok(prompt.includes("end the run with `submit_response({ skip_response: true })`"));
    // React-and-post / post-only end with the deliver_to entry
    assert.ok(prompt.includes("**React-and-post**"));
  });

  it("extends the never-reveal-automation rule to reactions", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("this applies to reactions just as much as to posts"));
  });

  it("tells Claude to read channel_purpose to calibrate channel character", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("`channel_name` and (when set) `channel_purpose`"));
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

  it("judges thread freshness by the last reply, not the parent, and ranks by last activity", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("Judge freshness by the LAST message, not the parent"));
    // Explains Slack's no-bump-on-reply behavior so old parents aren't dismissed
    assert.ok(prompt.includes("does NOT bump a thread when a new reply lands"));
    assert.ok(prompt.includes("rank candidate threads by `last_reply.ts`"));
  });

  it("gates joining per-thread by the leaf author, scoped so fresh openers are never blocked", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    // Joinability is decided per-thread by the leaf (last reply, or the message itself)
    assert.ok(prompt.includes("A thread is joinable only if its LATEST message is from a human"));
    assert.ok(prompt.includes("check `last_reply.is_bot`"));
    assert.ok(prompt.includes("If it has NO replies"));
    // ...but a fresh opener must NOT be blocked by other bots' posts
    assert.ok(
      prompt.includes(
        "Other bots' recent posts (trivia, digests, notices) do NOT block a fresh opener",
      ),
    );
    // A bot-dominated channel is not "impossible" — still post
    assert.ok(prompt.includes("is NOT impossibility"));
  });

  it("allows replying to a fresh human message with no replies (don't require 3 replies)", () => {
    const prompt = buildPrompt({
      die: 28,
      rateLabel: "daily (1/28)",
      channels: ["C111"],
      smallTalkTopics: ["food"],
    });
    assert.ok(prompt.includes("A recent human top-level message with few or NO replies"));
    assert.ok(prompt.includes("Don't require 3 replies before answering a fresh human message"));
    assert.ok(prompt.includes("Reply to a fresh human message"));
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

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { ENGAGEMENT_CONTENT } from "./engagement.js";

describe("casual-talk engagement topic content", () => {
  it("carries the channel-triage mechanics", () => {
    assert.ok(ENGAGEMENT_CONTENT.includes("include_threads: true"));
    assert.ok(ENGAGEMENT_CONTENT.includes("reply_count"));
    assert.ok(ENGAGEMENT_CONTENT.includes("Judge freshness by the LAST message, not the parent"));
    assert.ok(ENGAGEMENT_CONTENT.includes("does NOT bump a thread when a new reply lands"));
    assert.ok(ENGAGEMENT_CONTENT.includes("rank candidate threads by `last_reply.ts`"));
    assert.ok(
      ENGAGEMENT_CONTENT.includes(
        "A thread is joinable only if its LATEST message is from a human",
      ),
    );
    assert.ok(ENGAGEMENT_CONTENT.includes("check `last_reply.is_bot`"));
  });

  it("frames a hit as a commitment with three non-exclusive moves", () => {
    assert.ok(ENGAGEMENT_CONTENT.includes("WHERE and HOW"));
    assert.ok(ENGAGEMENT_CONTENT.includes("three NON-EXCLUSIVE positive moves"));
    assert.ok(ENGAGEMENT_CONTENT.includes("**react**"));
    assert.ok(ENGAGEMENT_CONTENT.includes("**post**"));
    assert.ok(ENGAGEMENT_CONTENT.includes("**both**"));
  });

  it("carries the reacting guidance with the human-leaf guard", () => {
    assert.ok(ENGAGEMENT_CONTENT.includes("Reacting is more open than posting"));
    assert.ok(ENGAGEMENT_CONTENT.includes("REACTABLE"));
    assert.ok(ENGAGEMENT_CONTENT.includes("call `find_emoji`"));
    assert.ok(ENGAGEMENT_CONTENT.includes("`add_reaction`"));
    assert.ok(
      ENGAGEMENT_CONTENT.includes("only react to a message whose LATEST content is from a human"),
    );
    assert.ok(ENGAGEMENT_CONTENT.includes("Never react to a bot-leaf message"));
    assert.ok(ENGAGEMENT_CONTENT.includes("no fixed cap"));
  });

  it("carries the full posting and termination contract", () => {
    assert.ok(ENGAGEMENT_CONTENT.includes("deliver_to` array holding exactly ONE entry"));
    assert.ok(
      ENGAGEMENT_CONTENT.includes("Do NOT also set `skip_response` when you are delivering"),
    );
    assert.ok(ENGAGEMENT_CONTENT.includes("**React-only**"));
    assert.ok(ENGAGEMENT_CONTENT.includes("**React-and-post**"));
    assert.match(ENGAGEMENT_CONTENT, /`attention_level: "high"` is MANDATORY/);
    assert.match(ENGAGEMENT_CONTENT, /`default_delivery_mode: "invisible"` is MANDATORY/);
    assert.ok(ENGAGEMENT_CONTENT.includes("INVISIBLE scheduled tick"));
  });

  it("extends the persona's never-reveal rule to reactions without restating the persona", () => {
    assert.ok(
      ENGAGEMENT_CONTENT.includes(
        "never-reveal-automation rule applies to reactions just as much as to posts",
      ),
    );
    // The persona constraints live in the pre-attached persona topic — not duplicated here.
    assert.ok(!ENGAGEMENT_CONTENT.includes("Vary your openers"));
    assert.ok(!ENGAGEMENT_CONTENT.includes("## Persona constraints"));
  });

  it("is static — no config-derived values, deferring die/channels/topics to the prompt", () => {
    // No die roll numbers, no channel ids, no rate labels.
    assert.ok(!ENGAGEMENT_CONTENT.includes("random_roll"));
    assert.ok(!ENGAGEMENT_CONTENT.includes("max:"));
    assert.ok(!/C[0-9]{3}/.test(ENGAGEMENT_CONTENT));
    // Config-derived context is referenced by pointing at the run prompt, not restated.
    assert.ok(ENGAGEMENT_CONTENT.includes("listed in the run prompt"));
    // The skip-strictness decision rule stays in the prompt; the topic defers to it.
    assert.ok(ENGAGEMENT_CONTENT.includes("governed by the triggering prompt's skip rules"));
  });
});

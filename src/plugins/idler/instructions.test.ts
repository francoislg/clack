import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { BEHAVIOR_INSTRUCTION } from "./instructions.js";

describe("BEHAVIOR_INSTRUCTION", () => {
  it("drops the anti-idle framing that incentivized busywork", () => {
    assert.ok(!/better than idling/i.test(BEHAVIOR_INSTRUCTION));
  });

  it("frames doing nothing as the correct default", () => {
    assert.match(BEHAVIOR_INSTRUCTION, /DEFAULT and correct outcome/);
    assert.match(BEHAVIOR_INSTRUCTION, /never manufacture|never do them|do NOT manufacture/i);
  });

  it("gates review on new commits since the last-reviewed cursor", () => {
    assert.match(BEHAVIOR_INSTRUCTION, /Review requires fresh commits/);
    assert.match(BEHAVIOR_INSTRUCTION, /new commits since the unit's last-reviewed cursor/);
    assert.match(BEHAVIOR_INSTRUCTION, /blocked: true/);
  });

  it("guards the @claude review re-trigger against unchanged PRs", () => {
    assert.match(BEHAVIOR_INSTRUCTION, /new commits since the last trigger/);
  });

  it("mandates the canonical PR review check with gated attach and full content read", () => {
    assert.match(BEHAVIOR_INSTRUCTION, /Handling PR references/);
    assert.match(BEHAVIOR_INSTRUCTION, /attach_integration\("github"\)/);
    assert.match(BEHAVIOR_INSTRUCTION, /only when PR references are in play/);
    assert.match(BEHAVIOR_INSTRUCTION, /get_reviews/);
    assert.match(BEHAVIOR_INSTRUCTION, /get_comments/);
    assert.match(BEHAVIOR_INSTRUCTION, /get_review_comments/);
    assert.match(BEHAVIOR_INSTRUCTION, /freshInput: true/);
  });

  it("overrides howToRead recipe text for PR references", () => {
    assert.match(BEHAVIOR_INSTRUCTION, /regardless of what the unit's howToRead says/);
    assert.match(BEHAVIOR_INSTRUCTION, /non-PR surfaces/);
  });
});

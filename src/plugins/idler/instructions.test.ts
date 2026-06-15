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
});

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { actionSchema, buttonLabelSchema } from "./submitResponse.js";
import { SLACK_BUTTON_LABEL_MAX } from "../../slack/blocks.js";

// Test fixture shape: a superset of every action variant's required fields. Each fixture
// builder fills only the fields its variant requires; unused fields stay `undefined`.
interface ActionFixture {
  type: string;
  label: string;
  prompt?: string;
  value?: string;
  blocks?: { type: string }[];
  ref?: string;
}

function makeAction(type: string, label: string): ActionFixture {
  switch (type) {
    case "followup":
      return { type, label, prompt: "go on" };
    case "choice":
      return { type, label, value: "v" };
    case "post_to":
      return { type, label, blocks: [{ type: "divider" }] };
    case "change":
    case "config_update":
    case "update":
    case "skill_create":
    case "skill_update":
    case "skill_disable":
    case "skill_restore":
      return { type, label, ref: "ref-1" };
    default:
      throw new Error(`unhandled action type in fixture: ${type}`);
  }
}

const ALL_LABEL_BEARING_ACTION_TYPES = [
  "followup",
  "choice",
  "post_to",
  "change",
  "config_update",
  "update",
  "skill_create",
  "skill_update",
  "skill_disable",
  "skill_restore",
] as const;

describe("buttonLabelSchema (shared)", () => {
  it(`accepts a label at the boundary (${SLACK_BUTTON_LABEL_MAX} chars)`, () => {
    const result = buttonLabelSchema.safeParse("a".repeat(SLACK_BUTTON_LABEL_MAX));
    assert.equal(result.success, true);
  });

  it(`rejects a label one char over the cap (${SLACK_BUTTON_LABEL_MAX + 1} chars) with a Zod max-length error`, () => {
    const result = buttonLabelSchema.safeParse("a".repeat(SLACK_BUTTON_LABEL_MAX + 1));
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.issues.length >= 1, true);
    const issue = result.error.issues[0];
    // Zod marks max-length string violations as "too_big". Assert on the code so the test
    // does not depend on Zod's localized message text.
    assert.equal(issue.code, "too_big");
  });

  it("rejects a clearly oversize label", () => {
    const result = buttonLabelSchema.safeParse("a".repeat(200));
    assert.equal(result.success, false);
  });
});

describe("action schema rejects oversize labels for every label-bearing action type", () => {
  for (const type of ALL_LABEL_BEARING_ACTION_TYPES) {
    it(`${type}: label at ${SLACK_BUTTON_LABEL_MAX} chars is accepted`, () => {
      const action = makeAction(type, "a".repeat(SLACK_BUTTON_LABEL_MAX));
      const result = actionSchema.safeParse(action);
      assert.equal(result.success, true, JSON.stringify(result));
    });

    it(`${type}: label at ${SLACK_BUTTON_LABEL_MAX + 1} chars is rejected`, () => {
      const action = makeAction(type, "a".repeat(SLACK_BUTTON_LABEL_MAX + 1));
      const result = actionSchema.safeParse(action);
      assert.equal(result.success, false);
      if (result.success) return;
      // The rejection should mention the `label` field in the issue path.
      const mentionsLabel = result.error.issues.some((issue) =>
        issue.path.some((segment) => segment === "label"),
      );
      assert.equal(mentionsLabel, true, JSON.stringify(result.error.issues));
    });
  }
});

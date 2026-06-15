import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { ActionsBlock } from "@slack/types";
import { stripClickedButton } from "./stripClickedButton.js";

function button(actionId: string, text: string) {
  return { type: "button", action_id: actionId, text: { type: "plain_text", text } };
}

describe("stripClickedButton", () => {
  it("drops the empty actions block and the divider directly above it for a single-button message", () => {
    const message = {
      text: "Proposal summary",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "Proposal body" } },
        { type: "divider" },
        { type: "actions", block_id: "b1", elements: [button("clack_change_0", "Accept")] },
      ],
    };

    const result = stripClickedButton(message, "clack_change_0");

    assert.ok(result);
    assert.equal(result.text, "Proposal summary");
    assert.deepEqual(result.blocks, [
      { type: "section", text: { type: "mrkdwn", text: "Proposal body" } },
    ]);
  });

  it("removes only the clicked button and keeps siblings on a multi-button message", () => {
    const message = {
      text: "Change ready",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "What next?" } },
        { type: "divider" },
        {
          type: "actions",
          block_id: "b1",
          elements: [
            button("clack_review_0", "Review"),
            button("clack_merge_1", "Merge"),
            button("clack_update_change_2", "Update"),
            button("clack_close_3", "Close"),
          ],
        },
      ],
    };

    const result = stripClickedButton(message, "clack_merge_1");

    assert.ok(result);
    const actions = result.blocks[2] as ActionsBlock;
    assert.equal(actions.type, "actions");
    const ids = (actions.elements as { action_id: string }[]).map((e) => e.action_id);
    assert.deepEqual(ids, ["clack_review_0", "clack_update_change_2", "clack_close_3"]);
    // The divider and section survive when siblings remain.
    assert.equal(result.blocks[1]?.type, "divider");
    assert.equal(result.blocks[0]?.type, "section");
  });

  it("preserves non-actions blocks and the text fallback verbatim", () => {
    const message = {
      text: "Keep me",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "Title" } },
        { type: "image", image_url: "https://example.com/a.png", alt_text: "a" },
        { type: "divider" },
        { type: "actions", elements: [button("clack_config_update_0", "Apply")] },
      ],
    };

    const result = stripClickedButton(message, "clack_config_update_0");

    assert.ok(result);
    assert.equal(result.text, "Keep me");
    assert.deepEqual(result.blocks, [
      { type: "header", text: { type: "plain_text", text: "Title" } },
      { type: "image", image_url: "https://example.com/a.png", alt_text: "a" },
    ]);
  });

  it("matches the clicked button strictly by action_id", () => {
    const message = {
      blocks: [
        {
          type: "actions",
          elements: [button("clack_skill_action_0", "Create"), button("clack_skill_action_1", "X")],
        },
      ],
    };

    const result = stripClickedButton(message, "clack_skill_action_1");

    assert.ok(result);
    const actions = result.blocks[0] as ActionsBlock;
    assert.equal(actions.type, "actions");
    const ids = (actions.elements as { action_id: string }[]).map((e) => e.action_id);
    assert.deepEqual(ids, ["clack_skill_action_0"]);
  });

  it("returns null when there is no clicked action_id", () => {
    const message = {
      blocks: [{ type: "actions", elements: [button("clack_change_0", "Accept")] }],
    };
    assert.equal(stripClickedButton(message, undefined), null);
  });

  it("returns null when the message has no blocks", () => {
    assert.equal(stripClickedButton({ text: "hi" }, "clack_change_0"), null);
    assert.equal(stripClickedButton(undefined, "clack_change_0"), null);
    assert.equal(stripClickedButton({ blocks: [] }, "clack_change_0"), null);
  });
});

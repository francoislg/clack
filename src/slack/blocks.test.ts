import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeActionValue,
  getStructuredResponseBlocks,
  getResponseActionBlocks,
  getStructuredAcceptedBlocks,
  getErrorBlocks,
  getErrorBlocksWithRetry,
  validateActionButtonLabels,
} from "./blocks.js";
import type { Action, SubmitResponsePayload } from "../tools/types.js";
import type { Block } from "./blockSchema.js";
import type { ActionsBlock, Button, SectionBlock, DividerBlock } from "@slack/types";

// ============================================================================
// decodeActionValue
// ============================================================================

describe("decodeActionValue", () => {
  it("decodes a JSON-encoded value with session ID", () => {
    const result = decodeActionValue(JSON.stringify({ s: "session-123" }));
    assert.equal(result.sessionId, "session-123");
  });

  it("decodes ref from JSON", () => {
    const result = decodeActionValue(JSON.stringify({ s: "session-123", r: "ref-abc" }));
    assert.equal(result.sessionId, "session-123");
    assert.equal(result.ref, "ref-abc");
  });

  it("decodes choice value and workMode", () => {
    const result = decodeActionValue(JSON.stringify({ s: "s1", v: "option-a", w: true }));
    assert.equal(result.choiceValue, "option-a");
    assert.equal(result.workMode, true);
  });

  it("decodes followup prompt", () => {
    const result = decodeActionValue(JSON.stringify({ s: "s1", p: "please continue" }));
    assert.equal(result.prompt, "please continue");
  });

  it("decodes post_to fields", () => {
    const result = decodeActionValue(
      JSON.stringify({ s: "s1", c: "C123", t: "1234.5678", sn: "snapshot-1" }),
    );
    assert.equal(result.targetChannel, "C123");
    assert.equal(result.targetThreadTs, "1234.5678");
    assert.equal(result.snapshotId, "snapshot-1");
  });

  it("falls back to plain string as sessionId for non-JSON", () => {
    const result = decodeActionValue("plain-session-id");
    assert.equal(result.sessionId, "plain-session-id");
    assert.equal(result.ref, undefined);
  });
});

// ============================================================================
// getResponseActionBlocks
// ============================================================================

describe("getResponseActionBlocks", () => {
  it("returns an empty array when there are no actions", () => {
    assert.deepEqual(getResponseActionBlocks([], "s1"), []);
  });

  it("skips auto-executed post_to actions (no button needed)", () => {
    const actions: Action[] = [
      { type: "post_to", auto: true, channel: "C1", blocks: [] },
      { type: "followup", label: "Continue", prompt: "go on" },
    ];
    const blocks = getResponseActionBlocks(actions, "s1");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].elements.length, 1);
  });

  it("packs up to 5 buttons per actions block and splits beyond", () => {
    const actions: Action[] = Array.from(
      { length: 7 },
      (_, i): Action => ({
        type: "followup",
        label: `Option ${i + 1}`,
        prompt: `p${i}`,
      }),
    );
    const blocks = getResponseActionBlocks(actions, "s1");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].elements.length, 5);
    assert.equal(blocks[1].elements.length, 2);
  });

  it("gives each button a unique action_id (index suffix)", () => {
    const actions: Action[] = [
      { type: "followup", label: "A", prompt: "a" },
      { type: "followup", label: "B", prompt: "b" },
    ];
    const [block] = getResponseActionBlocks(actions, "s1");
    const ids = block.elements.map((el) => (el as Button).action_id);
    assert.deepEqual(ids, ["clack_followup_0", "clack_followup_1"]);
  });

  it("sets 'primary' style on post_to buttons", () => {
    const actions: Action[] = [{ type: "post_to", blocks: [{ type: "divider" }] }];
    const [block] = getResponseActionBlocks(actions, "s1");
    const button = block.elements[0] as Button;
    assert.equal(button.style, "primary");
  });
});

// ============================================================================
// getStructuredResponseBlocks
// ============================================================================

describe("getStructuredResponseBlocks", () => {
  it("renders just the blocks when no message or actions", () => {
    const payload: SubmitResponsePayload = {
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
      actions: [],
    };
    const out = getStructuredResponseBlocks(payload, "s1");
    assert.equal(out.length, 1);
    assert.equal((out[0] as SectionBlock).type, "section");
  });

  it("prepends the message as a mrkdwn section preamble", () => {
    const payload: SubmitResponsePayload = {
      message: "Here it is:",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Body" } }],
      actions: [],
    };
    const out = getStructuredResponseBlocks(payload, "s1");
    assert.equal(out.length, 2);
    const preamble = out[0] as SectionBlock;
    assert.equal(preamble.type, "section");
    assert.equal(preamble.text?.text, "Here it is:");
  });

  it("appends a divider before action blocks", () => {
    const payload: SubmitResponsePayload = {
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Body" } }],
      actions: [{ type: "followup", label: "Next", prompt: "..." }],
    };
    const out = getStructuredResponseBlocks(payload, "s1");
    // section + divider + actions
    assert.equal(out.length, 3);
    assert.equal((out[1] as DividerBlock).type, "divider");
    assert.equal((out[2] as ActionsBlock).type, "actions");
  });

  it("omits the divider when there are no action buttons", () => {
    const payload: SubmitResponsePayload = {
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Body" } }],
      actions: [],
    };
    const out = getStructuredResponseBlocks(payload, "s1");
    assert.equal(out.length, 1);
  });
});

// ============================================================================
// getStructuredAcceptedBlocks
// ============================================================================

describe("getStructuredAcceptedBlocks", () => {
  it("returns prepared blocks without message preamble or action buttons", () => {
    const blocks: Block[] = [
      { type: "header", text: { type: "plain_text", text: "Title" } },
      { type: "section", text: { type: "mrkdwn", text: "Body" } },
    ];
    const out = getStructuredAcceptedBlocks(blocks);
    assert.equal(out.length, 2);
  });
});

// ============================================================================
// getErrorBlocks / getErrorBlocksWithRetry
// ============================================================================

describe("getErrorBlocks", () => {
  it("renders an error section", () => {
    const out = getErrorBlocks("Something failed");
    assert.equal(out.length, 1);
    const section = out[0] as SectionBlock;
    assert.ok(section.text?.text.includes("Something failed"));
  });
});

describe("getErrorBlocksWithRetry", () => {
  it("renders an error section and a retry button", () => {
    const out = getErrorBlocksWithRetry("s1");
    assert.equal(out.length, 2);
    assert.equal((out[0] as SectionBlock).type, "section");
    const actions = out[1] as ActionsBlock;
    assert.equal(actions.type, "actions");
    const button = actions.elements[0] as Button;
    assert.equal(button.action_id, "clack_retry");
    assert.equal(button.value, "s1");
  });
});

// ============================================================================
// validateActionButtonLabels
// ============================================================================

describe("validateActionButtonLabels", () => {
  it("returns no errors for short labels", () => {
    const actions: Action[] = [{ type: "followup", label: "Hi", prompt: "p" }];
    const blocks = getResponseActionBlocks(actions, "s1");
    assert.deepEqual(validateActionButtonLabels(blocks), []);
  });

  it("flags labels over the 75-char limit", () => {
    const longLabel = "a".repeat(76);
    const actions: Action[] = [{ type: "followup", label: longLabel, prompt: "p" }];
    const blocks = getResponseActionBlocks(actions, "s1");
    const errors = validateActionButtonLabels(blocks);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].currentLength, 76);
    assert.equal(errors[0].limit, 75);
  });
});

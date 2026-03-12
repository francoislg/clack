import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeActionValue,
  getStructuredResponseBlocks,
  getResponseActionBlocks,
  getStructuredAcceptedBlocks,
  getAcceptedBlocks,
  getErrorBlocks,
  getErrorBlocksWithRetry,
  validateSlackBlocks,
} from "./blocks.js";
import type { Action, SubmitResponsePayload } from "../tools/types.js";

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

  it("decodes send_to_thread fields", () => {
    const result = decodeActionValue(JSON.stringify({
      s: "s1",
      c: "C123",
      t: "1234.5678",
      sn: "snapshot-1",
    }));
    assert.equal(result.targetChannel, "C123");
    assert.equal(result.targetThreadTs, "1234.5678");
    assert.equal(result.snapshotId, "snapshot-1");
  });

  it("falls back to plain string as sessionId for non-JSON", () => {
    const result = decodeActionValue("plain-session-id");
    assert.equal(result.sessionId, "plain-session-id");
    assert.equal(result.ref, undefined);
  });

  it("handles workMode=false by returning undefined", () => {
    const result = decodeActionValue(JSON.stringify({ s: "s1", w: false }));
    assert.equal(result.workMode, undefined);
  });
});

// ============================================================================
// getErrorBlocks
// ============================================================================

describe("getErrorBlocks", () => {
  it("returns a single section block with :x: prefix", () => {
    const blocks = getErrorBlocks("Something went wrong");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "section");
    assert.deepEqual(blocks[0].text, {
      type: "mrkdwn",
      text: ":x: Something went wrong",
    });
  });

  it("preserves the exact message text", () => {
    const blocks = getErrorBlocks("Rate limit exceeded — try again in 30s");
    const text = (blocks[0].text as { text: string }).text;
    assert.ok(text.includes("Rate limit exceeded"));
  });
});

// ============================================================================
// getErrorBlocksWithRetry
// ============================================================================

describe("getErrorBlocksWithRetry", () => {
  it("returns a warning section and an actions block with retry button", () => {
    const blocks = getErrorBlocksWithRetry("sess-42");
    assert.equal(blocks.length, 2);

    // First block: warning section
    assert.equal(blocks[0].type, "section");
    const warningText = (blocks[0].text as { text: string }).text;
    assert.ok(warningText.includes(":warning:"));

    // Second block: actions with a retry button
    assert.equal(blocks[1].type, "actions");
    const elements = blocks[1].elements as Array<Record<string, unknown>>;
    assert.equal(elements.length, 1);
    assert.equal(elements[0].type, "button");
    assert.equal(elements[0].action_id, "clack_retry");
    assert.equal(elements[0].value, "sess-42");
  });
});

// ============================================================================
// getAcceptedBlocks
// ============================================================================

describe("getAcceptedBlocks", () => {
  it("returns section blocks for a short answer", () => {
    const blocks = getAcceptedBlocks("Hello world");
    assert.ok(blocks.length >= 1);
    assert.equal(blocks[0].type, "section");
    const text = (blocks[0].text as { type: string; text: string });
    assert.equal(text.type, "mrkdwn");
    assert.ok(text.text.includes("Hello world"));
  });
});

// ============================================================================
// getStructuredAcceptedBlocks
// ============================================================================

describe("getStructuredAcceptedBlocks", () => {
  it("renders sections without title", () => {
    const blocks = getStructuredAcceptedBlocks([
      { body: "Some explanation" },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "section");
    const text = (blocks[0].text as { text: string }).text;
    assert.ok(text.includes("Some explanation"));
  });

  it("renders sections with title as bold prefix", () => {
    const blocks = getStructuredAcceptedBlocks([
      { title: "Summary", body: "Here is the summary." },
    ]);
    assert.equal(blocks.length, 1);
    const text = (blocks[0].text as { text: string }).text;
    // Title should be bold (*Title*) followed by body
    assert.ok(text.startsWith("_Summary_"));
    assert.ok(text.includes("Here is the summary."));
  });

  it("renders multiple sections in order", () => {
    const blocks = getStructuredAcceptedBlocks([
      { body: "First" },
      { body: "Second" },
      { body: "Third" },
    ]);
    assert.equal(blocks.length, 3);
    assert.ok((blocks[0].text as { text: string }).text.includes("First"));
    assert.ok((blocks[1].text as { text: string }).text.includes("Second"));
    assert.ok((blocks[2].text as { text: string }).text.includes("Third"));
  });
});

// ============================================================================
// getResponseActionBlocks
// ============================================================================

describe("getResponseActionBlocks", () => {
  it("returns empty array when no actions", () => {
    const blocks = getResponseActionBlocks([], "sess-1");
    assert.equal(blocks.length, 0);
  });

  it("filters out auto-executed actions", () => {
    const actions: Action[] = [
      { type: "change", ref: "r1", auto: true },
      { type: "followup", label: "Continue", prompt: "go on" },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-1");
    assert.equal(blocks.length, 1);
    const elements = blocks[0].elements as Array<Record<string, unknown>>;
    assert.equal(elements.length, 1);
    // The remaining button should be the followup
    assert.ok((elements[0].action_id as string).startsWith("clack_followup"));
  });

  it("returns empty when all actions are auto", () => {
    const actions: Action[] = [
      { type: "send_to_thread", auto: true },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-1");
    assert.equal(blocks.length, 0);
  });

  it("creates button with correct action_id for each action type", () => {
    const actions: Action[] = [
      { type: "followup", label: "Next", prompt: "next" },
      { type: "choice", label: "Pick A", value: "a" },
      { type: "send_to_thread" },
      { type: "change", ref: "r1" },
      { type: "config_update", ref: "c1" },
      { type: "update", ref: "u1" },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-1");
    // 6 buttons — fits in 2 action blocks (5 + 1)
    assert.equal(blocks.length, 2);

    const allElements = blocks.flatMap(
      (b) => b.elements as Array<Record<string, unknown>>
    );
    assert.equal(allElements.length, 6);

    // Verify action_id prefixes
    assert.ok((allElements[0].action_id as string).startsWith("clack_followup"));
    assert.ok((allElements[1].action_id as string).startsWith("clack_choice"));
    assert.ok((allElements[2].action_id as string).startsWith("clack_dm_send_to_thread"));
    assert.ok((allElements[3].action_id as string).startsWith("clack_change"));
    assert.ok((allElements[4].action_id as string).startsWith("clack_config_update"));
    // "update" maps to "clack_update_change" to avoid collision
    assert.ok((allElements[5].action_id as string).startsWith("clack_update_change"));
  });

  it("uses default labels when none provided", () => {
    const actions: Action[] = [
      { type: "send_to_thread" },
      { type: "change", ref: "r1" },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-1");
    const elements = blocks[0].elements as Array<Record<string, unknown>>;

    const sendLabel = (elements[0].text as { text: string }).text;
    assert.equal(sendLabel, "Send to thread");

    const changeLabel = (elements[1].text as { text: string }).text;
    assert.equal(changeLabel, "Start Change");
  });

  it("uses custom labels when provided", () => {
    const actions: Action[] = [
      { type: "change", ref: "r1", label: "Implement Feature" },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-1");
    const elements = blocks[0].elements as Array<Record<string, unknown>>;
    const label = (elements[0].text as { text: string }).text;
    assert.equal(label, "Implement Feature");
  });

  it("applies primary style to send_to_thread and change buttons", () => {
    const actions: Action[] = [
      { type: "send_to_thread" },
      { type: "change", ref: "r1" },
      { type: "followup", label: "Continue", prompt: "go" },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-1");
    const elements = blocks[0].elements as Array<Record<string, unknown>>;

    assert.equal(elements[0].style, "primary");
    assert.equal(elements[1].style, "primary");
    // followup has no style
    assert.equal(elements[2].style, undefined);
  });

  it("splits into multiple action blocks when more than 5 buttons", () => {
    const actions: Action[] = Array.from({ length: 7 }, (_, i) => ({
      type: "followup" as const,
      label: `Option ${i}`,
      prompt: `prompt-${i}`,
    }));
    const blocks = getResponseActionBlocks(actions, "sess-1");
    assert.equal(blocks.length, 2);

    const firstElements = blocks[0].elements as Array<Record<string, unknown>>;
    const secondElements = blocks[1].elements as Array<Record<string, unknown>>;
    assert.equal(firstElements.length, 5);
    assert.equal(secondElements.length, 2);
  });

  it("encodes session ID and action data in button value", () => {
    const actions: Action[] = [
      { type: "followup", label: "Go", prompt: "do it" },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-xyz");
    const elements = blocks[0].elements as Array<Record<string, unknown>>;
    const value = JSON.parse(elements[0].value as string);
    assert.equal(value.s, "sess-xyz");
    assert.equal(value.p, "do it");
  });

  it("encodes choice value and workMode in button value", () => {
    const actions: Action[] = [
      { type: "choice", label: "Pick", value: "v1", workMode: true },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-1");
    const elements = blocks[0].elements as Array<Record<string, unknown>>;
    const value = JSON.parse(elements[0].value as string);
    assert.equal(value.v, "v1");
    assert.equal(value.w, true);
  });

  it("encodes ref in change/config_update/update button values", () => {
    const actions: Action[] = [
      { type: "change", ref: "change-ref" },
      { type: "config_update", ref: "config-ref" },
      { type: "update", ref: "update-ref" },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-1");
    const elements = blocks.flatMap(
      (b) => b.elements as Array<Record<string, unknown>>
    );
    assert.equal(JSON.parse(elements[0].value as string).r, "change-ref");
    assert.equal(JSON.parse(elements[1].value as string).r, "config-ref");
    assert.equal(JSON.parse(elements[2].value as string).r, "update-ref");
  });

  it("encodes send_to_thread channel, thread_ts, and snapshotId", () => {
    const actions: Action[] = [
      {
        type: "send_to_thread",
        channel: "C999",
        thread_ts: "111.222",
        _snapshotId: "snap-1",
      },
    ];
    const blocks = getResponseActionBlocks(actions, "sess-1");
    const elements = blocks[0].elements as Array<Record<string, unknown>>;
    const value = JSON.parse(elements[0].value as string);
    assert.equal(value.c, "C999");
    assert.equal(value.t, "111.222");
    assert.equal(value.sn, "snap-1");
  });

  it("assigns incrementing indices to action_ids across chunks", () => {
    const actions: Action[] = Array.from({ length: 6 }, (_, i) => ({
      type: "followup" as const,
      label: `Opt ${i}`,
      prompt: `p${i}`,
    }));
    const blocks = getResponseActionBlocks(actions, "sess-1");
    const allElements = blocks.flatMap(
      (b) => b.elements as Array<Record<string, unknown>>
    );
    for (let i = 0; i < 6; i++) {
      assert.ok((allElements[i].action_id as string).endsWith(`_${i}`));
    }
  });
});

// ============================================================================
// getStructuredResponseBlocks
// ============================================================================

describe("getStructuredResponseBlocks", () => {
  it("renders sections without actions and no divider", () => {
    const payload: SubmitResponsePayload = {
      sections: [{ body: "Hello" }],
      actions: [],
    };
    const blocks = getStructuredResponseBlocks(payload, "sess-1");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "section");
    // No divider when there are no actions
    assert.ok(blocks.every((b) => b.type !== "divider"));
  });

  it("adds a divider before action blocks when actions exist", () => {
    const payload: SubmitResponsePayload = {
      sections: [{ body: "Answer text" }],
      actions: [{ type: "followup", label: "More", prompt: "more" }],
    };
    const blocks = getStructuredResponseBlocks(payload, "sess-1");
    // section, divider, actions
    assert.ok(blocks.length >= 3);
    const types = blocks.map((b) => b.type);
    assert.ok(types.includes("divider"));
    // divider should come after sections and before actions
    const dividerIdx = types.indexOf("divider");
    assert.ok(dividerIdx > 0);
    assert.equal(types[dividerIdx + 1], "actions");
  });

  it("includes message preamble before sections", () => {
    const payload: SubmitResponsePayload = {
      message: "Here is what I found:",
      sections: [{ body: "Details" }],
      actions: [],
    };
    const blocks = getStructuredResponseBlocks(payload, "sess-1");
    assert.ok(blocks.length >= 2);
    // First block should be the message preamble
    const first = blocks[0] as Record<string, unknown>;
    const firstText = (first.text as { text: string }).text;
    assert.ok(firstText.includes("Here is what I found:"));
    // Second block should be the section body
    const second = blocks[1] as Record<string, unknown>;
    const secondText = (second.text as { text: string }).text;
    assert.ok(secondText.includes("Details"));
  });

  it("works with empty sections and actions", () => {
    const payload: SubmitResponsePayload = {
      sections: [],
      actions: [],
    };
    const blocks = getStructuredResponseBlocks(payload, "sess-1");
    assert.equal(blocks.length, 0);
  });

  it("skips divider when all actions are auto-executed", () => {
    const payload: SubmitResponsePayload = {
      sections: [{ body: "Done" }],
      actions: [{ type: "send_to_thread", auto: true }],
    };
    const blocks = getStructuredResponseBlocks(payload, "sess-1");
    assert.ok(blocks.every((b) => b.type !== "divider"));
    assert.ok(blocks.every((b) => b.type !== "actions"));
  });
});

// ============================================================================
// validateSlackBlocks
// ============================================================================

describe("validateSlackBlocks", () => {
  it("returns no errors for valid blocks", () => {
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: "Short text" } },
      { type: "divider" },
    ];
    const errors = validateSlackBlocks(blocks);
    assert.equal(errors.length, 0);
  });

  it("detects section text exceeding 3000 chars", () => {
    const longText = "x".repeat(3001);
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: longText } },
    ];
    const errors = validateSlackBlocks(blocks);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "section[0]");
    assert.equal(errors[0].currentLength, 3001);
    assert.equal(errors[0].limit, 3000);
  });

  it("allows section text at exactly 3000 chars", () => {
    const exactText = "x".repeat(3000);
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: exactText } },
    ];
    const errors = validateSlackBlocks(blocks);
    assert.equal(errors.length, 0);
  });

  it("detects button label exceeding 75 chars", () => {
    const longLabel = "a".repeat(76);
    const blocks = [
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: longLabel } },
        ],
      },
    ];
    const errors = validateSlackBlocks(blocks);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "actions[0].button[0]");
    assert.equal(errors[0].currentLength, 76);
    assert.equal(errors[0].limit, 75);
  });

  it("detects total block count exceeding 50", () => {
    const blocks = Array.from({ length: 51 }, () => ({
      type: "section",
      text: { type: "mrkdwn", text: "ok" },
    }));
    const errors = validateSlackBlocks(blocks);
    // At least the block count error
    const blockCountError = errors.find((e) => e.field === "blocks");
    assert.ok(blockCountError);
    assert.equal(blockCountError!.currentLength, 51);
    assert.equal(blockCountError!.limit, 50);
  });

  it("reports multiple errors at once", () => {
    const longText = "x".repeat(3001);
    const longLabel = "a".repeat(80);
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: longText } },
      { type: "section", text: { type: "mrkdwn", text: longText } },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: longLabel } },
        ],
      },
    ];
    const errors = validateSlackBlocks(blocks);
    assert.equal(errors.length, 3);
    assert.equal(errors[0].field, "section[0]");
    assert.equal(errors[1].field, "section[1]");
    assert.equal(errors[2].field, "actions[0].button[0]");
  });

  it("handles blocks with no text object gracefully", () => {
    const blocks = [
      { type: "section", text: undefined },
    ];
    const errors = validateSlackBlocks(blocks);
    // Empty text "" is under limit — no error
    assert.equal(errors.length, 0);
  });

  it("counts section indices independently of other block types", () => {
    const longText = "x".repeat(3001);
    const blocks = [
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: "ok" } },
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: longText } },
    ];
    const errors = validateSlackBlocks(blocks);
    assert.equal(errors.length, 1);
    // The second section (index 1) is the one that's too long
    assert.equal(errors[0].field, "section[1]");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { synthesizeMessagesFromLegacy } from "../sessions.js";
import type { SynthesizeInput } from "../sessions.js";
import type { SubmitResponsePayload } from "../tools/types.js";

function makeLegacy(overrides: Partial<SynthesizeInput> = {}): SynthesizeInput {
  return {
    originalQuestion: "what is the answer",
    lastActivity: 2000,
    createdAt: 1000,
    ...overrides,
  };
}

describe("synthesizeMessagesFromLegacy", () => {
  it("produces an empty messages[] with a user-first trigger for a session with no refinements and no answer", () => {
    const { trigger, messages } = synthesizeMessagesFromLegacy(
      makeLegacy({ triggerType: "mentions", userId: "U1" }),
    );
    if (trigger.type === "scheduled") {
      assert.fail("expected user-first trigger");
    }
    assert.equal(trigger.type, "mentions");
    assert.equal(trigger.messageText, "what is the answer");
    assert.equal(messages.length, 0);
  });

  it("appends each refinement as a source: 'reply' user message", () => {
    const { messages } = synthesizeMessagesFromLegacy(
      makeLegacy({
        triggerType: "mentions",
        userId: "U1",
        refinements: ["follow up 1", "follow up 2"],
      }),
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "user");
    assert.equal((messages[0] as { source: string }).source, "reply");
    assert.equal((messages[1] as { source: string }).source, "reply");
  });

  it("preserves the 'The user chose: ...' prefix verbatim as source: 'reply' (no retroactive parsing)", () => {
    const { messages } = synthesizeMessagesFromLegacy(
      makeLegacy({
        triggerType: "mentions",
        userId: "U1",
        refinements: ["The user chose: left"],
      }),
    );
    assert.equal(messages.length, 1);
    const refinement = messages[0] as { source: string; text: string; value?: string };
    assert.equal(refinement.source, "reply");
    assert.equal(refinement.text, "The user chose: left");
    assert.equal(refinement.value, undefined);
  });

  it("appends a single AssistantMessage with text + payload + toolCalls when legacy answer fields are present", () => {
    const payload: SubmitResponsePayload = { message: "preamble", blocks: [], actions: [] };
    const { messages } = synthesizeMessagesFromLegacy(
      makeLegacy({
        triggerType: "mentions",
        userId: "U1",
        lastAnswer: "rendered text",
        lastResponse: payload,
        toolCallHistory: [{ tool: "list_repositories", args: {}, result: {}, timestamp: 1500 }],
      }),
    );
    assert.equal(messages.length, 1);
    const assistant = messages[0] as {
      role: "assistant";
      ts: number;
      text?: string;
      payload?: SubmitResponsePayload;
      toolCalls?: unknown[];
    };
    assert.equal(assistant.role, "assistant");
    assert.equal(assistant.ts, 2000);
    assert.equal(assistant.text, "rendered text");
    assert.deepEqual(assistant.payload, payload);
    assert.equal(assistant.toolCalls?.length, 1);
  });

  it("appends an AssistantMessage when only lastResponse (no lastAnswer) is present", () => {
    const payload: SubmitResponsePayload = { blocks: [], actions: [] };
    const { messages } = synthesizeMessagesFromLegacy(
      makeLegacy({ triggerType: "mentions", userId: "U1", lastResponse: payload }),
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "assistant");
  });

  it("does not append an AssistantMessage when neither lastAnswer nor lastResponse is set", () => {
    const { messages } = synthesizeMessagesFromLegacy(
      makeLegacy({ triggerType: "mentions", userId: "U1", refinements: ["r1"] }),
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "user");
  });

  it("carries imageFiles onto the trigger (not onto messages[])", () => {
    const { trigger } = synthesizeMessagesFromLegacy(
      makeLegacy({
        triggerType: "mentions",
        userId: "U1",
        imageFiles: [
          {
            id: "F1",
            name: "img.png",
            mimetype: "image/png",
            size: 100,
            url_private: "https://slack/files/F1",
          },
        ],
      }),
    );
    if (trigger.type === "scheduled") {
      assert.fail("expected user-first trigger");
    }
    assert.equal(trigger.imageFiles?.length, 1);
  });

  it("produces a complete message list for a fully-populated legacy session (trigger holds the first user message, messages[] starts at refinement #1)", () => {
    const payload: SubmitResponsePayload = { blocks: [], actions: [] };
    const { trigger, messages } = synthesizeMessagesFromLegacy(
      makeLegacy({
        triggerType: "mentions",
        userId: "U1",
        refinements: ["r1", "The user chose: foo"],
        lastAnswer: "done",
        lastResponse: payload,
      }),
    );
    if (trigger.type === "scheduled") {
      assert.fail("expected user-first trigger");
    }
    assert.equal(trigger.type, "mentions");
    assert.equal(messages.length, 3);
    assert.equal(messages[0].role, "user");
    assert.equal(messages[1].role, "user");
    assert.equal(messages[2].role, "assistant");
  });

  it("infers 'scheduled' trigger for scheduled triggerType with prompt in originalQuestion", () => {
    const { trigger } = synthesizeMessagesFromLegacy(
      makeLegacy({ triggerType: "scheduled", originalQuestion: "Run the nightly" }),
    );
    assert.equal(trigger.type, "scheduled");
    if (trigger.type === "scheduled") {
      assert.equal(trigger.prompt, "Run the nightly");
    }
  });

  it("lifts a first-wave unified-log `source:'initial'` entry off messages[] into the trigger", () => {
    const { trigger, messages } = synthesizeMessagesFromLegacy({
      triggerType: "mentions",
      userId: "U1",
      createdAt: 1000,
      lastActivity: 2000,
      messages: [
        { role: "user", source: "initial" as "reply", text: "first-wave q", ts: 1000 },
        { role: "assistant", ts: 1500, text: "a1" },
        { role: "user", source: "refinement" as "reply", text: "r1", ts: 1800 },
      ],
    });
    if (trigger.type === "scheduled") {
      assert.fail("expected user-first trigger");
    }
    assert.equal(trigger.messageText, "first-wave q");
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "assistant");
    assert.equal(messages[1].role, "user");
    assert.equal((messages[1] as { source: string }).source, "reply");
  });
});

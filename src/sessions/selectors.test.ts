import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  firstUserMessage,
  latestAssistantMessage,
  latestAssistantText,
  latestAssistantPayload,
  userContinuations,
  conversationLog,
  triggerText,
} from "./selectors.js";
import type {
  SessionContext,
  SessionMessage,
  SessionAssistantMessage,
  SessionUserMessage,
  SessionTrigger,
} from "../sessions.js";

const defaultTrigger: SessionTrigger = {
  type: "mentions",
  userId: "U1",
  messageTs: "1.0",
  messageText: "hello",
};

function makeSession(
  messages: SessionMessage[] | undefined,
  trigger: SessionTrigger = defaultTrigger,
): SessionContext {
  return {
    sessionId: "s",
    channelId: "C1",
    messageTs: "1.0",
    threadTs: "1.0",
    userId: "U1",
    trigger,
    threadContext: [],
    errors: [],
    lastActivity: 0,
    createdAt: 1000,
    messages: messages ?? [],
  };
}

const userReply: SessionUserMessage = {
  role: "user",
  source: "reply",
  text: "more context",
  ts: 2000,
};

const userChoice: SessionUserMessage = {
  role: "user",
  source: "choice",
  text: "Go Left",
  value: "left",
  ts: 3000,
};

const assistantFirst: SessionAssistantMessage = {
  role: "assistant",
  ts: 1500,
  text: "first answer",
  payload: { message: "first preamble", blocks: [], actions: [] },
};

const assistantSecond: SessionAssistantMessage = {
  role: "assistant",
  ts: 2500,
  text: "second answer",
  payload: { blocks: [], actions: [] },
};

const assistantSkipped: SessionAssistantMessage = {
  role: "assistant",
  ts: 3500,
  skipped: true,
};

const assistantErrored: SessionAssistantMessage = {
  role: "assistant",
  ts: 4500,
  error: { timestamp: 4500, errorMessage: "boom", conversationTrace: [] },
};

describe("sessions/selectors", () => {
  describe("empty messages (just a trigger)", () => {
    const s = makeSession(undefined);

    it("firstUserMessage synthesizes from trigger.messageText", () => {
      assert.equal(firstUserMessage(s).text, "hello");
      assert.equal(firstUserMessage(s).source, "reply");
    });

    it("triggerText returns trigger.messageText for user-first triggers", () => {
      assert.equal(triggerText(s), "hello");
    });

    it("latestAssistantMessage returns undefined", () => {
      assert.equal(latestAssistantMessage(s), undefined);
    });

    it("latestAssistantText returns undefined", () => {
      assert.equal(latestAssistantText(s), undefined);
    });

    it("latestAssistantPayload returns undefined", () => {
      assert.equal(latestAssistantPayload(s), undefined);
    });

    it("userContinuations returns an empty array", () => {
      assert.deepEqual(userContinuations(s), []);
    });

    it("conversationLog returns an empty array", () => {
      assert.deepEqual(conversationLog(s), []);
    });
  });

  describe("scheduled trigger", () => {
    const s = makeSession(undefined, {
      type: "scheduled",
      prompt: "Run the nightly report",
      jobId: "nightly",
    });

    it("triggerText returns trigger.prompt for scheduled triggers", () => {
      assert.equal(triggerText(s), "Run the nightly report");
    });

    it("firstUserMessage synthesizes from trigger.prompt", () => {
      assert.equal(firstUserMessage(s).text, "Run the nightly report");
    });
  });

  describe("assistant-first session (post-split)", () => {
    const s = makeSession([assistantFirst, userReply, assistantSecond, userChoice]);

    it("latestAssistantMessage returns the most recent assistant entry", () => {
      assert.deepEqual(latestAssistantMessage(s), assistantSecond);
    });

    it("latestAssistantText returns the most recent assistant's `text`", () => {
      assert.equal(latestAssistantText(s), "second answer");
    });

    it("latestAssistantText falls back to payload.message when text is absent", () => {
      const only = makeSession([{ ...assistantFirst, text: undefined }]);
      assert.equal(latestAssistantText(only), "first preamble");
    });

    it("latestAssistantPayload returns the most recent assistant's payload", () => {
      assert.deepEqual(latestAssistantPayload(s), assistantSecond.payload);
    });

    it("userContinuations returns every user entry in messages[]", () => {
      assert.deepEqual(userContinuations(s), [userReply, userChoice]);
    });

    it("conversationLog returns every message in order", () => {
      assert.equal(conversationLog(s).length, 4);
    });
  });

  describe("skipped latest turn", () => {
    const s = makeSession([assistantFirst, userReply, assistantSkipped]);

    it("latestAssistantMessage returns the skipped entry", () => {
      assert.deepEqual(latestAssistantMessage(s), assistantSkipped);
    });

    it("latestAssistantText returns undefined (no payload, no text)", () => {
      assert.equal(latestAssistantText(s), undefined);
    });

    it("latestAssistantPayload returns undefined", () => {
      assert.equal(latestAssistantPayload(s), undefined);
    });
  });

  describe("errored latest turn", () => {
    const s = makeSession([assistantErrored]);

    it("latestAssistantMessage returns the errored entry with error populated", () => {
      const m = latestAssistantMessage(s);
      assert.ok(m?.error);
      assert.equal(m?.error?.errorMessage, "boom");
    });

    it("latestAssistantText returns undefined when only an error was recorded", () => {
      assert.equal(latestAssistantText(s), undefined);
    });
  });
});

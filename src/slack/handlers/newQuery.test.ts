import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockProcessMessage = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockIsDev = mock.fn<(userId: string) => Promise<boolean>>(async () => false);
const mockExtractMessageText = mock.fn<(msg: Record<string, unknown>) => string>(() => "");

// Config mock — needs to return a config object with reactions shape
const mockConfig = {
  reactions: {
    trigger: "robot_face",
    changesWorkflow: undefined as { enabled: boolean; trigger?: string } | undefined,
  },
};
const mockGetConfig = mock.fn(() => mockConfig);

mock.module("./core.js", {
  namedExports: { processMessage: mockProcessMessage },
});

mock.module("../../config.js", {
  namedExports: { getConfig: mockGetConfig },
});

mock.module("../../roles.js", {
  namedExports: { isDev: mockIsDev },
});

mock.module("../messagesApi.js", {
  namedExports: { extractMessageText: mockExtractMessageText },
});

mock.module("../blocks.js", {
  namedExports: {
    getErrorBlocks: (msg: string) => [{ type: "section", text: { type: "mrkdwn", text: msg } }],
  },
});

mock.module("../../logger.js", {
  namedExports: {
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  },
});

// Import after mocks
const { registerNewQueryHandler } = await import("./newQuery.js");

// ============================================================================
// Helpers
// ============================================================================

type EventHandler = (args: {
  event: {
    reaction: string;
    user: string;
    item: { type: string; channel: string; ts: string };
  };
  client: App["client"];
}) => Promise<void>;

let capturedHandler: EventHandler;

function makeApp(): App {
  return {
    event: (_eventType: string, handler: EventHandler) => {
      capturedHandler = handler;
    },
  } as unknown as App;
}

function makeClient(): App["client"] {
  const postEphemeralFn = mock.fn(async () => ({ ok: true }));
  const repliesFn = mock.fn(async () => ({
    messages: [
      { ts: "1700000000.000001", text: "original message", thread_ts: "1700000000.000001" },
    ],
  }));
  const historyFn = mock.fn(async () => ({ messages: [] }));

  return {
    conversations: {
      replies: repliesFn,
      history: historyFn,
    },
    chat: {
      postEphemeral: postEphemeralFn,
    },
  } as unknown as App["client"];
}

beforeEach(() => {
  mockProcessMessage.mock.resetCalls();
  mockIsDev.mock.resetCalls();
  mockExtractMessageText.mock.resetCalls();
  mockGetConfig.mock.resetCalls();

  // Reset config to defaults
  mockConfig.reactions.trigger = "robot_face";
  mockConfig.reactions.changesWorkflow = undefined;

  // Default: extractMessageText returns the text
  mockExtractMessageText.mock.mockImplementation(
    (msg: Record<string, unknown>) => (msg.text as string) || "",
  );

  // Register handler
  const app = makeApp();
  registerNewQueryHandler(app);
});

// ============================================================================
// Tests
// ============================================================================

describe("registerNewQueryHandler", () => {
  it("registers a reaction_added event handler", () => {
    assert.ok(capturedHandler, "handler should have been registered");
  });

  it("ignores reactions that do not match the trigger", async () => {
    const client = makeClient();

    await capturedHandler({
      event: {
        reaction: "thumbsup",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("ignores non-message reaction items", async () => {
    const client = makeClient();

    await capturedHandler({
      event: {
        reaction: "robot_face",
        user: "U001",
        item: { type: "file", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("processes a matching reaction on a message", async () => {
    const client = makeClient();
    mockExtractMessageText.mock.mockImplementation(() => "some question");

    await capturedHandler({
      event: {
        reaction: "robot_face",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    const args = mockProcessMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.userId, "U001");
    assert.equal(args.channelId, "C001");
    assert.equal(args.messageTs, "1700000000.000001");
    assert.equal(args.messageText, "some question");
    assert.equal(args.triggerType, "reactions");
    assert.equal(args.workMode, false);
  });

  it("posts ephemeral error when message text cannot be resolved", async () => {
    const client = makeClient();
    // Make replies return empty text
    mockExtractMessageText.mock.mockImplementation(() => "");
    (client.conversations.replies as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => ({
        messages: [{ ts: "1700000000.000001", text: "", thread_ts: "1700000000.000001" }],
      }),
    );

    await capturedHandler({
      event: {
        reaction: "robot_face",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 0);
    const postEphemeral = client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const args = postEphemeral.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.channel, "C001");
    assert.equal(args.user, "U001");
  });

  it("falls back to conversations.history when replies fails", async () => {
    const client = makeClient();
    // Make replies throw, history return the message
    (client.conversations.replies as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => {
        throw new Error("not found");
      },
    );
    (client.conversations.history as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => ({
        messages: [{ ts: "1700000000.000001", text: "found via history" }],
      }),
    );
    mockExtractMessageText.mock.mockImplementation(() => "found via history");

    await capturedHandler({
      event: {
        reaction: "robot_face",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    const args = mockProcessMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.messageText, "found via history");
  });
});

describe("registerNewQueryHandler — changes workflow trigger", () => {
  it("uses work trigger when changesWorkflow is enabled and reaction matches", async () => {
    mockConfig.reactions.changesWorkflow = { enabled: true, trigger: "hammer" };
    mockIsDev.mock.mockImplementation(async () => true);
    mockExtractMessageText.mock.mockImplementation(() => "build the feature");

    // Re-register with updated config
    const app = makeApp();
    registerNewQueryHandler(app);

    const client = makeClient();

    await capturedHandler({
      event: {
        reaction: "hammer",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    const args = mockProcessMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.workMode, true);
  });

  it("does not set workMode when user is not a dev", async () => {
    mockConfig.reactions.changesWorkflow = { enabled: true, trigger: "hammer" };
    mockIsDev.mock.mockImplementation(async () => false);
    mockExtractMessageText.mock.mockImplementation(() => "build the feature");

    const app = makeApp();
    registerNewQueryHandler(app);

    const client = makeClient();

    await capturedHandler({
      event: {
        reaction: "hammer",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    const args = mockProcessMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.workMode, false);
  });

  it("ignores work trigger when changesWorkflow is not enabled", async () => {
    mockConfig.reactions.changesWorkflow = undefined;
    mockExtractMessageText.mock.mockImplementation(() => "build it");

    const app = makeApp();
    registerNewQueryHandler(app);

    const client = makeClient();

    await capturedHandler({
      event: {
        reaction: "hammer",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    // "hammer" doesn't match "robot_face", so should be ignored
    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });
});

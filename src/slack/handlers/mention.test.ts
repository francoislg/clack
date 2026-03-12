import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockProcessMessage = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});

mock.module("./core.js", {
  namedExports: { processMessage: mockProcessMessage },
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
const { registerMentionHandler } = await import("./mention.js");

// ============================================================================
// Helpers
// ============================================================================

type EventHandler = (args: {
  event: {
    user?: string;
    channel: string;
    text: string;
    ts: string;
    thread_ts?: string;
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

function makeClient(botUserId = "B001"): App["client"] {
  const postMessageFn = mock.fn(async () => ({ ok: true }));
  return {
    auth: {
      test: mock.fn(async () => ({ user_id: botUserId })),
    },
    chat: {
      postMessage: postMessageFn,
    },
  } as unknown as App["client"];
}

beforeEach(() => {
  mockProcessMessage.mock.resetCalls();

  // Register handler
  const app = makeApp();
  registerMentionHandler(app);
});

// ============================================================================
// Tests
// ============================================================================

describe("registerMentionHandler", () => {
  it("registers an app_mention event handler", () => {
    assert.ok(capturedHandler, "handler should have been registered");
  });

  it("returns early when event has no user", async () => {
    await capturedHandler({
      event: {
        user: undefined,
        channel: "C001",
        text: "<@B001> hello",
        ts: "1700000000.000001",
      },
      client: makeClient(),
    });

    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("strips the bot mention from the text", async () => {
    const client = makeClient("B001");

    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001> what is this function?",
        ts: "1700000000.000001",
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    const args = mockProcessMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.messageText, "what is this function?");
  });

  it("strips multiple bot mentions", async () => {
    const client = makeClient("B001");

    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001> hello <@B001> world",
        ts: "1700000000.000001",
      },
      client,
    });

    const args = mockProcessMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.messageText, "hello world");
  });

  it("posts a help message when text is empty and not in a thread", async () => {
    const client = makeClient("B001");

    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001>",
        ts: "1700000000.000001",
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 0);

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(msgArgs.channel, "C001");
    assert.equal(msgArgs.thread_ts, "1700000000.000001");
    assert.ok((msgArgs.text as string).includes("include a question"));
  });

  it("uses a default prompt when text is empty but in a thread", async () => {
    const client = makeClient("B001");

    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001>",
        ts: "1700000000.000002",
        thread_ts: "1700000000.000001",
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    const args = mockProcessMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.ok((args.messageText as string).includes("Read the conversation above"));
  });

  it("passes correct parameters to processMessage", async () => {
    const client = makeClient("B001");

    await capturedHandler({
      event: {
        user: "U123",
        channel: "C456",
        text: "<@B001> explain this code",
        ts: "1700000000.000099",
        thread_ts: "1700000000.000001",
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    const args = mockProcessMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.client, client);
    assert.equal(args.userId, "U123");
    assert.equal(args.channelId, "C456");
    assert.equal(args.messageTs, "1700000000.000099");
    assert.equal(args.messageText, "explain this code");
    assert.equal(args.threadTs, "1700000000.000001");
    assert.equal(args.triggerType, "mentions");
  });

  it("passes undefined threadTs when not in a thread", async () => {
    const client = makeClient("B001");

    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001> hello",
        ts: "1700000000.000001",
      },
      client,
    });

    const args = mockProcessMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.threadTs, undefined);
  });
});

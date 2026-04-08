import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { registerMentionHandler, type MentionDeps } from "./mention.js";

// ============================================================================
// Helpers
// ============================================================================

const mockProcessMessage = mock.fn<(...args: never[]) => Promise<void>>(async () => {});

function makeDeps(): MentionDeps {
  return {
    getConfig: () => ({ mentions: { enabled: true } }) as never,
    processMessage: mockProcessMessage as never,
    findSessionByThread: async () => null,
    setAutoResponseActive: async () => {},
  };
}

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
  } as App;
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
  } as never;
}

beforeEach(() => {
  mockProcessMessage.mock.resetCalls();

  // Register handler
  const app = makeApp();
  registerMentionHandler(app, makeDeps());
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
    interface ProcessMessageArg {
      messageText: string;
    }
    const args = mockProcessMessage.mock.calls[0]!.arguments[0] as ProcessMessageArg;
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

    interface ProcessMessageArg {
      messageText: string;
    }
    const args = mockProcessMessage.mock.calls[0]!.arguments[0] as ProcessMessageArg;
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

    interface PostMessageArg {
      channel: string;
      thread_ts: string;
      text: string;
    }
    interface PostMessageMock {
      (args: PostMessageArg): Promise<{ ok: boolean }>;
      mock: {
        callCount(): number;
        calls: Array<{ arguments: PostMessageArg[] }>;
      };
    }
    const postMessage = client.chat.postMessage as PostMessageMock;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0]!.arguments[0];
    assert.equal(msgArgs.channel, "C001");
    assert.equal(msgArgs.thread_ts, "1700000000.000001");
    assert.ok(msgArgs.text.includes("include a question"));
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
    interface ProcessMessageArg {
      messageText: string;
    }
    const args = mockProcessMessage.mock.calls[0]!.arguments[0] as ProcessMessageArg;
    assert.ok(args.messageText.includes("Read the conversation above"));
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
    interface ProcessMessageArg {
      client: App["client"];
      userId: string;
      channelId: string;
      messageTs: string;
      messageText: string;
      threadTs?: string;
      triggerType: string;
    }
    const args = mockProcessMessage.mock.calls[0]!.arguments[0] as ProcessMessageArg;
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

    interface ProcessMessageArg {
      threadTs?: string;
    }
    const args = mockProcessMessage.mock.calls[0]!.arguments[0] as ProcessMessageArg;
    assert.equal(args.threadTs, undefined);
  });
});

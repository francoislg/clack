import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { registerMentionHandler, type MentionDeps } from "./mention.js";

// ============================================================================
// Helpers
// ============================================================================

const mockProcessMessage = vi.fn<(...args: never[]) => Promise<void>>(async () => {});

function makeDeps(): MentionDeps {
  return {
    getConfig: () => ({ mentions: { enabled: true } }) as never,
    processMessage: mockProcessMessage as never,
    findSessionByThread: async () => null,
    setAutoResponseActive: async () => {},
    stopThread: mockStopThread,
  };
}

const mockStopThread = vi.fn<MentionDeps["stopThread"]>(async () => ({
  queryAborted: 0,
  workerAborted: false,
  queuedCancelled: false,
  sessionDisengaged: false,
}));

interface IncomingFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private: string;
}

type EventHandler = (args: {
  event: {
    user?: string;
    channel: string;
    text: string;
    ts: string;
    thread_ts?: string;
    files?: IncomingFile[];
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
  const postMessageFn = vi.fn(async () => ({ ok: true }));
  return {
    auth: {
      test: vi.fn(async () => ({ user_id: botUserId })),
    },
    chat: {
      postMessage: postMessageFn,
    },
  } as never;
}

beforeEach(() => {
  mockProcessMessage.mockClear();

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

    assert.equal(mockProcessMessage.mock.calls.length, 0);
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

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    interface ProcessMessageArg {
      messageText: string;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
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
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
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

    assert.equal(mockProcessMessage.mock.calls.length, 0);

    interface PostMessageArg {
      channel: string;
      thread_ts: string;
      text: string;
    }
    interface PostMessageMock {
      (args: PostMessageArg): Promise<{ ok: boolean }>;
      mock: {
        calls: PostMessageArg[][];
      };
    }
    const postMessage = client.chat.postMessage as PostMessageMock;
    assert.equal(postMessage.mock.calls.length, 1);
    const msgArgs = postMessage.mock.calls[0]![0];
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

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    interface ProcessMessageArg {
      messageText: string;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
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

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    interface ProcessMessageArg {
      client: App["client"];
      userId: string;
      channelId: string;
      messageTs: string;
      messageText: string;
      threadTs?: string;
      triggerType: string;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
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
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
    assert.equal(args.threadTs, undefined);
  });

  it("processes top-level image-only @mention with image fallback prompt", async () => {
    const client = makeClient("B001");

    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001>",
        ts: "1700000000.000001",
        files: [
          {
            id: "F1",
            name: "screenshot.png",
            mimetype: "image/png",
            size: 1024,
            url_private: "https://files.slack.com/F1",
          },
        ],
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    interface ProcessMessageArg {
      messageText: string;
      imageFiles?: Array<{ id: string }>;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
    assert.equal(args.messageText, "Answer based on the attached image(s).");
    assert.equal(args.imageFiles?.length, 1);
    assert.equal(args.imageFiles?.[0].id, "F1");
  });

  it("uses thread fallback prompt for in-thread image-only @mention and forwards images", async () => {
    const client = makeClient("B001");

    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001>",
        ts: "1700000000.000002",
        thread_ts: "1700000000.000001",
        files: [
          {
            id: "F2",
            name: "diagram.jpg",
            mimetype: "image/jpeg",
            size: 2048,
            url_private: "https://files.slack.com/F2",
          },
        ],
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    interface ProcessMessageArg {
      messageText: string;
      imageFiles?: Array<{ id: string }>;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
    assert.ok(args.messageText.includes("Read the conversation above"));
    assert.equal(args.imageFiles?.length, 1);
    assert.equal(args.imageFiles?.[0].id, "F2");
  });

  it("posts help message when empty text and no images and not in thread", async () => {
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

    assert.equal(mockProcessMessage.mock.calls.length, 0);
  });
});

// ============================================================================
// Inline stop-emoji detection
// ============================================================================

const mockInlineProcess = vi.fn<MentionDeps["processMessage"]>(async () => ({
  success: true,
  answer: "",
}));

function makeStopDeps(stopEmoji: string | null = "octagonal_sign"): MentionDeps {
  return {
    getConfig: () => ({
      mentions: { enabled: true },
      reactions: { stop: stopEmoji },
    }),
    processMessage: mockInlineProcess,
    findSessionByThread: async () => null,
    setAutoResponseActive: async () => {},
    stopThread: mockStopThread,
  };
}

describe("registerMentionHandler — inline stop emoji", () => {
  beforeEach(() => {
    mockStopThread.mockClear();
    mockInlineProcess.mockClear();
    const app = makeApp();
    registerMentionHandler(app, makeStopDeps());
  });

  it("stops when the mention body is only the Unicode stop emoji", async () => {
    const client = makeClient();
    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001> \u{1F6D1}",
        ts: "1700000000.000001",
      },
      client,
    });
    assert.equal(mockStopThread.mock.calls.length, 1);
    assert.equal(mockInlineProcess.mock.calls.length, 0);
    const args = mockStopThread.mock.calls[0];
    assert.equal(args?.[0], "C001");
    assert.equal(args?.[1], "1700000000.000001");
    assert.equal(args?.[2], "U001");
    assert.equal(args?.[3], "stopped via inline emoji");
  });

  it("stops when the mention body uses the colon shortcode form", async () => {
    const client = makeClient();
    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001> :octagonal_sign:",
        ts: "1700000000.000001",
      },
      client,
    });
    assert.equal(mockStopThread.mock.calls.length, 1);
    assert.equal(mockInlineProcess.mock.calls.length, 0);
  });

  it("uses thread_ts when the mention is in a thread", async () => {
    const client = makeClient();
    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001> \u{1F6D1} please stop",
        ts: "1700000000.000002",
        thread_ts: "1700000000.000001",
      },
      client,
    });
    assert.equal(mockStopThread.mock.calls[0]?.[1], "1700000000.000001");
  });

  it("does NOT stop when the mention body exceeds 60 chars even with the emoji", async () => {
    const client = makeClient();
    const longText = `<@B001> \u{1F6D1} ${"x".repeat(70)}`;
    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: longText,
        ts: "1700000000.000001",
      },
      client,
    });
    assert.equal(mockStopThread.mock.calls.length, 0);
    assert.equal(mockInlineProcess.mock.calls.length, 1);
  });

  it("does NOT stop when config.reactions.stop is null", async () => {
    const app = makeApp();
    registerMentionHandler(app, makeStopDeps(null));
    const client = makeClient();
    await capturedHandler({
      event: {
        user: "U001",
        channel: "C001",
        text: "<@B001> \u{1F6D1}",
        ts: "1700000000.000001",
      },
      client,
    });
    assert.equal(mockStopThread.mock.calls.length, 0);
    assert.equal(mockInlineProcess.mock.calls.length, 1);
  });
});

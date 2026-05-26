import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { registerNewQueryHandler, type NewQueryDeps } from "./newQuery.js";

// ============================================================================
// Helpers
// ============================================================================

const mockProcessMessage = vi.fn<(...args: never[]) => Promise<void>>(async () => {});
const mockIsDev = vi.fn<(userId: string) => Promise<boolean>>(async () => false);
const mockExtractMessageText = vi.fn<(msg: never) => string>(() => "");

// Config mock — needs to return a config object with reactions shape
const mockConfig = {
  reactions: {
    trigger: "robot_face",
    changesWorkflow: undefined as { enabled: boolean; trigger?: string } | undefined,
  },
};
const mockGetConfig = vi.fn(() => mockConfig);

function makeDeps(): NewQueryDeps {
  return {
    getConfig: mockGetConfig as never,
    processMessage: mockProcessMessage as never,
    isDev: mockIsDev,
    extractMessageText: mockExtractMessageText as never,
  };
}

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
  } as App;
}

const mockRepliesFn = vi.fn(async () => ({
  messages: [{ ts: "1700000000.000001", text: "original message", thread_ts: "1700000000.000001" }],
}));
const mockHistoryFn = vi.fn(async () => ({ messages: [] as object[] }));
const mockPostEphemeralFn = vi.fn<
  (args: { channel: string; user: string; text?: string }) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }));

function makeClient(): App["client"] {
  return {
    auth: {
      test: vi.fn(async () => ({ url: "https://test.slack.com/" })),
    },
    conversations: {
      replies: mockRepliesFn,
      history: mockHistoryFn,
      info: vi.fn(async () => ({ ok: false })),
    },
    chat: {
      postEphemeral: mockPostEphemeralFn,
    },
  } as object as App["client"];
}

beforeEach(() => {
  mockProcessMessage.mockClear();
  mockIsDev.mockClear();
  mockExtractMessageText.mockClear();
  mockGetConfig.mockClear();
  mockRepliesFn.mockClear();
  mockHistoryFn.mockClear();
  mockPostEphemeralFn.mockClear();
  mockRepliesFn.mockImplementation(async () => ({
    messages: [
      { ts: "1700000000.000001", text: "original message", thread_ts: "1700000000.000001" },
    ],
  }));
  mockHistoryFn.mockImplementation(async () => ({ messages: [] }));

  // Reset config to defaults
  mockConfig.reactions.trigger = "robot_face";
  mockConfig.reactions.changesWorkflow = undefined;

  // Default: extractMessageText returns the text
  mockExtractMessageText.mockImplementation(
    (msg: never) => ((msg as { text?: string }).text as string) || "",
  );

  // Register handler
  const app = makeApp();
  registerNewQueryHandler(app, makeDeps());
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

    assert.equal(mockProcessMessage.mock.calls.length, 0);
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

    assert.equal(mockProcessMessage.mock.calls.length, 0);
  });

  it("processes a matching reaction on a message", async () => {
    const client = makeClient();
    mockExtractMessageText.mockImplementation(() => "some question");

    await capturedHandler({
      event: {
        reaction: "robot_face",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    interface ProcessMessageArg {
      userId: string;
      channelId: string;
      messageTs: string;
      messageText: string;
      triggerType: string;
      workMode: boolean;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
    assert.equal(args.userId, "U001");
    assert.equal(args.channelId, "C001");
    assert.equal(args.messageTs, "1700000000.000001");
    assert.equal(args.messageText, "some question");
    assert.equal(args.triggerType, "reactions");
    assert.equal(args.workMode, false);
  });

  it("posts ephemeral error when message has no text and no files", async () => {
    const client = makeClient();
    // Make replies return empty text and no files
    mockExtractMessageText.mockImplementation(() => "");
    mockRepliesFn.mockImplementation(async () => ({
      messages: [{ ts: "1700000000.000001", text: "", thread_ts: "1700000000.000001" }],
    }));

    await capturedHandler({
      event: {
        reaction: "robot_face",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.calls.length, 0);
    const postEphemeral = mockPostEphemeralFn;
    assert.equal(postEphemeral.mock.calls.length, 1);
    interface PostEphemeralArg {
      channel: string;
      user: string;
    }
    const args = postEphemeral.mock.calls[0]![0] as PostEphemeralArg;
    assert.equal(args.channel, "C001");
    assert.equal(args.user, "U001");
  });

  it("processes reaction on image-only message with the reaction-specific fallback", async () => {
    const client = makeClient();
    mockExtractMessageText.mockImplementation(() => "");
    mockRepliesFn.mockImplementation(async () => ({
      messages: [
        {
          ts: "1700000000.000001",
          text: "",
          thread_ts: "1700000000.000001",
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
      ],
    }));

    await capturedHandler({
      event: {
        reaction: "robot_face",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    assert.equal(mockPostEphemeralFn.mock.calls.length, 0);
    interface ProcessMessageArg {
      messageText: string;
      imageFiles?: Array<{ id: string }>;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
    assert.ok(args.messageText.includes("A user reacted to this message"));
    assert.ok(args.messageText.includes("attached image"));
    assert.equal(args.imageFiles?.length, 1);
    assert.equal(args.imageFiles?.[0].id, "F1");
  });

  it("falls back to conversations.history when replies fails", async () => {
    const client = makeClient();
    // Make replies throw, history return the message
    mockRepliesFn.mockImplementation(async () => {
      throw new Error("not found");
    });
    mockHistoryFn.mockImplementation(async () => ({
      messages: [{ ts: "1700000000.000001", text: "found via history" }],
    }));
    mockExtractMessageText.mockImplementation(() => "found via history");

    await capturedHandler({
      event: {
        reaction: "robot_face",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    interface ProcessMessageArg {
      messageText: string;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
    assert.equal(args.messageText, "found via history");
  });
});

describe("registerNewQueryHandler — changes workflow trigger", () => {
  it("uses work trigger when changesWorkflow is enabled and reaction matches", async () => {
    mockConfig.reactions.changesWorkflow = { enabled: true, trigger: "hammer" };
    mockIsDev.mockImplementation(async () => true);
    mockExtractMessageText.mockImplementation(() => "build the feature");

    // Re-register with updated config
    const app = makeApp();
    registerNewQueryHandler(app, makeDeps());

    const client = makeClient();

    await capturedHandler({
      event: {
        reaction: "hammer",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    interface ProcessMessageArg {
      workMode: boolean;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
    assert.equal(args.workMode, true);
  });

  it("does not set workMode when user is not a dev", async () => {
    mockConfig.reactions.changesWorkflow = { enabled: true, trigger: "hammer" };
    mockIsDev.mockImplementation(async () => false);
    mockExtractMessageText.mockImplementation(() => "build the feature");

    const app = makeApp();
    registerNewQueryHandler(app, makeDeps());

    const client = makeClient();

    await capturedHandler({
      event: {
        reaction: "hammer",
        user: "U001",
        item: { type: "message", channel: "C001", ts: "1700000000.000001" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.calls.length, 1);
    interface ProcessMessageArg {
      workMode: boolean;
    }
    const args = mockProcessMessage.mock.calls[0]![0] as ProcessMessageArg;
    assert.equal(args.workMode, false);
  });

  it("ignores work trigger when changesWorkflow is not enabled", async () => {
    mockConfig.reactions.changesWorkflow = undefined;
    mockExtractMessageText.mockImplementation(() => "build it");

    const app = makeApp();
    registerNewQueryHandler(app, makeDeps());

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
    assert.equal(mockProcessMessage.mock.calls.length, 0);
  });
});

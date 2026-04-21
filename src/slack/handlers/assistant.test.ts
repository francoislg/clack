import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { registerAssistant, type AssistantDeps } from "./assistant.js";

interface CapturedProcessArgs {
  client: App["client"];
  userId: string;
  channelId: string;
  messageTs: string;
  messageText: string;
  threadTs?: string;
  triggerType: string;
  assistantChannelId?: string;
  imageFiles?: Array<{ id: string; name: string; mimetype: string }>;
  files?: Array<{ id: string; name: string; mimetype: string }>;
}

// ============================================================================
// Mocks
// ============================================================================

const mockProcessMessage = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockFindSessionByThread = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);
const mockUpdateSession = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);

interface AssistantHandlers {
  threadStarted: (...args: unknown[]) => Promise<void>;
  threadContextChanged: (...args: unknown[]) => Promise<void>;
  userMessage: (...args: unknown[]) => Promise<void>;
}

let capturedAssistantHandlers: AssistantHandlers | null = null;

class MockAssistant {
  constructor(handlers: AssistantHandlers) {
    capturedAssistantHandlers = handlers;
  }
}

function makeDeps(): AssistantDeps {
  return {
    Assistant: MockAssistant as never,
    getConfig: () => ({ directMessages: { enabled: true } }),
    findSessionByThread: mockFindSessionByThread as never,
    updateSession: mockUpdateSession as never,
    processMessage: mockProcessMessage as never,
    extractAttachments: () => ({}),
    stopThread: mockAssistantStopThread,
  };
}

const mockAssistantStopThread = mock.fn<AssistantDeps["stopThread"]>(async () => ({
  queryAborted: 0,
  workerAborted: false,
  sessionDisengaged: false,
}));

// ============================================================================
// Helpers
// ============================================================================

let capturedAssistant: unknown;

function makeApp(): App {
  return {
    assistant: (assistant: unknown) => {
      capturedAssistant = assistant;
    },
  } as never as App;
}

function makeClient(botUserId = "B001") {
  const postMessageFn = mock.fn(async () => ({ ok: true }));
  const repliesFn = mock.fn<() => Promise<{ messages: object[] }>>(async () => ({ messages: [] }));
  return {
    obj: {
      auth: {
        test: mock.fn(async () => ({ user_id: botUserId })),
      },
      chat: {
        postMessage: postMessageFn,
      },
      conversations: {
        replies: repliesFn,
      },
    } as never as App["client"],
    repliesFn,
  };
}

beforeEach(() => {
  mockProcessMessage.mock.resetCalls();
  mockFindSessionByThread.mock.resetCalls();
  mockUpdateSession.mock.resetCalls();
  capturedAssistantHandlers = null;
  capturedAssistant = null;

  const app = makeApp();
  registerAssistant(app, makeDeps());
});

// ============================================================================
// Tests
// ============================================================================

describe("registerAssistant", () => {
  it("registers an assistant with the app", () => {
    assert.ok(capturedAssistant, "assistant should have been passed to app.assistant()");
  });

  it("captures thread handlers", () => {
    assert.ok(capturedAssistantHandlers, "Assistant constructor should receive handlers");
    assert.ok(capturedAssistantHandlers.threadStarted);
    assert.ok(capturedAssistantHandlers.threadContextChanged);
    assert.ok(capturedAssistantHandlers.userMessage);
  });
});

describe("assistant threadStarted", () => {
  it("sends a greeting and saves thread context", async () => {
    const mockSay = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const mockSaveThreadContext = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const mockSetSuggestedPrompts = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});

    await capturedAssistantHandlers!.threadStarted({
      event: {
        assistant_thread: {
          context: { channel_id: "C001" },
        },
      },
      say: mockSay,
      saveThreadContext: mockSaveThreadContext,
      setSuggestedPrompts: mockSetSuggestedPrompts,
    });

    assert.equal(mockSay.mock.callCount(), 1);
    const greeting = mockSay.mock.calls[0].arguments[0] as string;
    assert.ok(greeting.includes("Hi"));

    assert.equal(mockSaveThreadContext.mock.callCount(), 1);
    assert.equal(mockSetSuggestedPrompts.mock.callCount(), 1);
  });

  it("includes channel-specific prompt when context has channel_id", async () => {
    const mockSay = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const mockSaveThreadContext = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const mockSetSuggestedPrompts = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});

    await capturedAssistantHandlers!.threadStarted({
      event: {
        assistant_thread: {
          context: { channel_id: "C001" },
        },
      },
      say: mockSay,
      saveThreadContext: mockSaveThreadContext,
      setSuggestedPrompts: mockSetSuggestedPrompts,
    });

    const promptsArg = mockSetSuggestedPrompts.mock.calls[0].arguments[0] as {
      prompts: Array<{ title: string; message: string }>;
    };
    // Should have channel-related prompt plus the standard ones
    assert.ok(promptsArg.prompts.length >= 3);
    assert.ok(promptsArg.prompts.some((p) => p.title.includes("recent messages")));
  });

  it("omits channel-specific prompt when context has no channel_id", async () => {
    const mockSay = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const mockSaveThreadContext = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const mockSetSuggestedPrompts = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});

    await capturedAssistantHandlers!.threadStarted({
      event: {
        assistant_thread: {
          context: {},
        },
      },
      say: mockSay,
      saveThreadContext: mockSaveThreadContext,
      setSuggestedPrompts: mockSetSuggestedPrompts,
    });

    const promptsArg = mockSetSuggestedPrompts.mock.calls[0].arguments[0] as {
      prompts: Array<{ title: string; message: string }>;
    };
    // Only the standard prompts (no channel-specific one)
    assert.equal(promptsArg.prompts.length, 2);
    assert.ok(!promptsArg.prompts.some((p) => p.title.includes("recent messages")));
  });
});

describe("assistant threadContextChanged", () => {
  it("saves thread context", async () => {
    const mockSaveThreadContext = mock.fn(async () => {});

    await capturedAssistantHandlers!.threadContextChanged({
      event: {
        assistant_thread: {
          context: { channel_id: "C002" },
          channel_id: "D001",
          thread_ts: "1700000000.000001",
        },
      },
      saveThreadContext: mockSaveThreadContext,
    });

    assert.equal(mockSaveThreadContext.mock.callCount(), 1);
  });

  it("updates session with new channel_id when session exists", async () => {
    const mockSaveThreadContext = mock.fn(async () => {});
    mockFindSessionByThread.mock.mockImplementation(async () => ({
      sessionId: "session-1",
    }));

    await capturedAssistantHandlers!.threadContextChanged({
      event: {
        assistant_thread: {
          context: { channel_id: "C002" },
          channel_id: "D001",
          thread_ts: "1700000000.000001",
        },
      },
      saveThreadContext: mockSaveThreadContext,
    });

    assert.equal(mockUpdateSession.mock.callCount(), 1);
    const updateArgs = mockUpdateSession.mock.calls[0].arguments;
    assert.equal(updateArgs[0], "session-1");
    assert.deepEqual(updateArgs[1], { assistantCurrentChannelId: "C002" });
  });

  it("does not update session when no session exists in thread", async () => {
    const mockSaveThreadContext = mock.fn(async () => {});
    mockFindSessionByThread.mock.mockImplementation(async () => null);

    await capturedAssistantHandlers!.threadContextChanged({
      event: {
        assistant_thread: {
          context: { channel_id: "C002" },
          channel_id: "D001",
          thread_ts: "1700000000.000001",
        },
      },
      saveThreadContext: mockSaveThreadContext,
    });

    assert.equal(mockUpdateSession.mock.callCount(), 0);
  });

  it("does not update session when channel_id is missing", async () => {
    const mockSaveThreadContext = mock.fn(async () => {});

    await capturedAssistantHandlers!.threadContextChanged({
      event: {
        assistant_thread: {
          context: {},
          channel_id: "D001",
          thread_ts: "1700000000.000001",
        },
      },
      saveThreadContext: mockSaveThreadContext,
    });

    assert.equal(mockUpdateSession.mock.callCount(), 0);
  });
});

describe("assistant userMessage", () => {
  function makeMockSetStatus() {
    return mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
  }
  function makeMockSetTitle() {
    return mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
  }
  function makeMockGetThreadContext() {
    return mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined);
  }

  it("skips when user is missing", async () => {
    await capturedAssistantHandlers!.userMessage({
      event: { text: "hello", channel: "D001", ts: "1700000000.000001" },
      client: makeClient().obj,
      setStatus: makeMockSetStatus(),
      setTitle: makeMockSetTitle(),
      getThreadContext: makeMockGetThreadContext(),
    });

    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("skips when text and files are both missing", async () => {
    await capturedAssistantHandlers!.userMessage({
      event: { user: "U001", channel: "D001", ts: "1700000000.000001" },
      client: makeClient().obj,
      setStatus: makeMockSetStatus(),
      setTitle: makeMockSetTitle(),
      getThreadContext: makeMockGetThreadContext(),
    });

    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("processes an image-only DM with the image fallback prompt", async () => {
    const clientBundle = makeClient();

    // Register a fresh app whose extractAttachments returns image files
    const app = makeApp();
    registerAssistant(app, {
      ...makeDeps(),
      extractAttachments: () => ({
        imageFiles: [
          {
            id: "F1",
            name: "screenshot.png",
            mimetype: "image/png",
            size: 1024,
            url_private: "https://files.slack.com/F1",
          },
        ],
      }),
    });

    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        channel: "D001",
        ts: "1700000000.000002",
        files: [{ id: "F1", mimetype: "image/png" }],
      },
      client: clientBundle.obj,
      setStatus: makeMockSetStatus(),
      setTitle: makeMockSetTitle(),
      getThreadContext: makeMockGetThreadContext(),
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    const args = mockProcessMessage.mock.calls[0].arguments[0] as CapturedProcessArgs;
    assert.equal(args.messageText, "Answer based on the attached image(s).");
    assert.ok(args.imageFiles);
    assert.equal(args.imageFiles.length, 1);
    assert.equal(args.imageFiles[0].id, "F1");
  });

  it("calls processMessage with correct parameters", async () => {
    const mockSetStatus = makeMockSetStatus();
    const mockGetThreadContext = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      channel_id: "C001",
    }));
    const clientBundle = makeClient();

    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        text: "what does this function do?",
        channel: "D001",
        ts: "1700000000.000002",
        thread_ts: "1700000000.000001",
      },
      client: clientBundle.obj,
      setStatus: mockSetStatus,
      setTitle: makeMockSetTitle(),
      getThreadContext: mockGetThreadContext,
    });

    assert.equal(mockSetStatus.mock.callCount(), 1);
    assert.equal(mockProcessMessage.mock.callCount(), 1);

    const args = mockProcessMessage.mock.calls[0].arguments[0] as CapturedProcessArgs;
    assert.equal(args.client, clientBundle.obj);
    assert.equal(args.userId, "U001");
    assert.equal(args.channelId, "D001");
    assert.equal(args.messageTs, "1700000000.000002");
    assert.equal(args.messageText, "what does this function do?");
    assert.equal(args.threadTs, "1700000000.000001");
    assert.equal(args.triggerType, "directMessages");
    assert.equal(args.assistantChannelId, "C001");
  });

  it("sets thread title from message text", async () => {
    const mockSetTitle = makeMockSetTitle();

    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        text: "short question",
        channel: "D001",
        ts: "1700000000.000001",
      },
      client: makeClient().obj,
      setStatus: makeMockSetStatus(),
      setTitle: mockSetTitle,
      getThreadContext: makeMockGetThreadContext(),
    });

    assert.equal(mockSetTitle.mock.callCount(), 1);
    assert.equal(mockSetTitle.mock.calls[0].arguments[0], "short question");
  });

  it("truncates title when text is longer than 50 characters", async () => {
    const mockSetTitle = makeMockSetTitle();
    const longText =
      "This is a very long question that exceeds fifty characters in total length for sure";

    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        text: longText,
        channel: "D001",
        ts: "1700000000.000001",
      },
      client: makeClient().obj,
      setStatus: makeMockSetStatus(),
      setTitle: mockSetTitle,
      getThreadContext: makeMockGetThreadContext(),
    });

    assert.equal(mockSetTitle.mock.callCount(), 1);
    const title = mockSetTitle.mock.calls[0].arguments[0] as string;
    assert.equal(title.length, 50);
    assert.ok(title.endsWith("…"));
  });

  it("does not crash when setTitle throws", async () => {
    const mockSetTitle = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {
      throw new Error("title failed");
    });

    // Should not throw
    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        text: "hello",
        channel: "D001",
        ts: "1700000000.000001",
      },
      client: makeClient().obj,
      setStatus: makeMockSetStatus(),
      setTitle: mockSetTitle,
      getThreadContext: makeMockGetThreadContext(),
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
  });

  it("resolves context from thread metadata when Bolt store returns nothing", async () => {
    const clientBundle = makeClient("B001");
    // Simulate a bot message with metadata containing channel_id
    clientBundle.repliesFn.mock.mockImplementation(async () => ({
      messages: [
        {
          user: "B001",
          ts: "1700000000.000001",
          metadata: {
            event_payload: { channel_id: "C999" },
          },
        },
      ],
    }));

    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        text: "hello",
        channel: "D001",
        ts: "1700000000.000002",
        thread_ts: "1700000000.000001",
      },
      client: clientBundle.obj,
      setStatus: makeMockSetStatus(),
      setTitle: makeMockSetTitle(),
      getThreadContext: makeMockGetThreadContext(),
    });

    const args = mockProcessMessage.mock.calls[0].arguments[0] as CapturedProcessArgs;
    assert.equal(args.assistantChannelId, "C999");
  });

  it("falls back to existing session context when metadata lookup fails", async () => {
    const clientBundle = makeClient("B001");
    // No bot messages with metadata
    clientBundle.repliesFn.mock.mockImplementation(async () => ({ messages: [] }));

    mockFindSessionByThread.mock.mockImplementation(async () => ({
      sessionId: "session-1",
      assistantCurrentChannelId: "C888",
    }));

    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        text: "hello",
        channel: "D001",
        ts: "1700000000.000002",
        thread_ts: "1700000000.000001",
      },
      client: clientBundle.obj,
      setStatus: makeMockSetStatus(),
      setTitle: makeMockSetTitle(),
      getThreadContext: makeMockGetThreadContext(),
    });

    const args = mockProcessMessage.mock.calls[0].arguments[0] as CapturedProcessArgs;
    assert.equal(args.assistantChannelId, "C888");
  });
});

// ============================================================================
// Inline stop-emoji detection (userMessage path)
// ============================================================================

function makeStopDeps(stopEmoji: string | null = "octagonal_sign"): AssistantDeps {
  const base = makeDeps();
  return {
    ...base,
    getConfig: () => ({
      directMessages: { enabled: true },
      reactions: { stop: stopEmoji },
    }),
  };
}

const stubStatus = async (_s: string): Promise<void> => {};
const stubTitle = async (_t: string): Promise<void> => {};
const stubThreadCtx = async (): Promise<undefined> => undefined;

describe("assistant userMessage — inline stop emoji", () => {
  beforeEach(() => {
    mockAssistantStopThread.mock.resetCalls();
    mockProcessMessage.mock.resetCalls();
    capturedAssistantHandlers = null;
    capturedAssistant = null;
    const app = makeApp();
    registerAssistant(app, makeStopDeps());
  });

  it("stops when a DM thread message is just the Unicode stop emoji", async () => {
    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        channel: "D001",
        text: "\u{1F6D1}",
        ts: "1700000000.000002",
        thread_ts: "1700000000.000001",
      },
      client: makeClient().obj,
      setStatus: stubStatus,
      setTitle: stubTitle,
      getThreadContext: stubThreadCtx,
    });
    assert.equal(mockAssistantStopThread.mock.callCount(), 1);
    assert.equal(mockProcessMessage.mock.callCount(), 0);
    const args = mockAssistantStopThread.mock.calls[0]?.arguments;
    assert.equal(args?.[0], "D001");
    assert.equal(args?.[1], "1700000000.000001");
    assert.equal(args?.[2], "U001");
    assert.equal(args?.[3], "stopped via inline emoji");
  });

  it("stops when a DM message is the colon shortcode form", async () => {
    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        channel: "D001",
        text: ":octagonal_sign: wait",
        ts: "1700000000.000001",
      },
      client: makeClient().obj,
      setStatus: stubStatus,
      setTitle: stubTitle,
      getThreadContext: stubThreadCtx,
    });
    assert.equal(mockAssistantStopThread.mock.callCount(), 1);
    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("does NOT stop on long messages containing the emoji", async () => {
    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        channel: "D001",
        text: `\u{1F6D1} ${"x".repeat(70)}`,
        ts: "1700000000.000001",
      },
      client: makeClient().obj,
      setStatus: stubStatus,
      setTitle: stubTitle,
      getThreadContext: stubThreadCtx,
    });
    assert.equal(mockAssistantStopThread.mock.callCount(), 0);
    assert.equal(mockProcessMessage.mock.callCount(), 1);
  });

  it("does NOT stop when config.reactions.stop is null", async () => {
    const app = makeApp();
    registerAssistant(app, makeStopDeps(null));
    await capturedAssistantHandlers!.userMessage({
      event: {
        user: "U001",
        channel: "D001",
        text: "\u{1F6D1}",
        ts: "1700000000.000001",
      },
      client: makeClient().obj,
      setStatus: stubStatus,
      setTitle: stubTitle,
      getThreadContext: stubThreadCtx,
    });
    assert.equal(mockAssistantStopThread.mock.callCount(), 0);
    assert.equal(mockProcessMessage.mock.callCount(), 1);
  });
});

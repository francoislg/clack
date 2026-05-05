import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { ClaudeResponse } from "../../claude/index.js";
import { makeFakeRunHandle } from "../../claude/runHandle.testFixtures.js";
import { registerMessageChangedHandler, type MessageChangedDeps } from "./messageChanged.js";

type ProcessMessageFn = MessageChangedDeps["processMessage"];
type ConfigShape = ReturnType<MessageChangedDeps["getConfig"]>;

const mockProcessMessage = mock.fn<ProcessMessageFn>(
  async (): Promise<ClaudeResponse> => ({
    success: true,
    answer: "",
  }),
);
const mockGetActiveRun = mock.fn<MessageChangedDeps["getActiveRunForChannelMessage"]>(
  () => undefined,
);
const mockFindSessionByThread = mock.fn<MessageChangedDeps["findSessionByThread"]>(
  async () => null,
);

const fakeConfig: ConfigShape = {
  directMessages: { enabled: true },
  mentions: { enabled: true },
} as ConfigShape;

function makeDeps(): MessageChangedDeps {
  return {
    getConfig: () => fakeConfig,
    getActiveRunForChannelMessage: mockGetActiveRun,
    findSessionByThread: mockFindSessionByThread,
    processMessage: mockProcessMessage,
  };
}

interface TestMessageEvent {
  subtype?: string;
  channel?: string;
  message?: { ts?: string; text?: string; user?: string; thread_ts?: string };
  previous_message?: { ts?: string; text?: string };
}

type EventHandler = (args: { event: TestMessageEvent; client: App["client"] }) => Promise<void>;

let capturedHandler: EventHandler;

const fakeApp: App = {
  event: (_eventType: string, handler: EventHandler) => {
    capturedHandler = handler;
  },
} as App;

function makeClient(botUserId = "B001"): App["client"] {
  const fakeClient: App["client"] = {
    auth: { test: async () => ({ user_id: botUserId }) },
  } as App["client"];
  return fakeClient;
}

function makeSession(triggerType: SessionContext["triggerType"]): SessionContext {
  return { sessionId: "session-1", triggerType } as SessionContext;
}

beforeEach(() => {
  mockProcessMessage.mock.resetCalls();
  mockGetActiveRun.mock.resetCalls();
  mockGetActiveRun.mock.mockImplementation(() => undefined);
  mockFindSessionByThread.mock.resetCalls();
  mockFindSessionByThread.mock.mockImplementation(async () => null);

  registerMessageChangedHandler(fakeApp, makeDeps());
});

// ============================================================================
// Tests
// ============================================================================

describe("registerMessageChangedHandler", () => {
  it("registers a message event handler", () => {
    assert.ok(capturedHandler, "handler should have been registered");
  });

  it("ignores events that are not message_changed subtype", async () => {
    await capturedHandler({
      event: { subtype: undefined, channel: "C001" },
      client: makeClient(),
    });
    assert.equal(mockGetActiveRun.mock.callCount(), 0);
  });

  it("ignores message_changed when messageTs is missing", async () => {
    await capturedHandler({
      event: { subtype: "message_changed", channel: "C001", message: { text: "new text" } },
      client: makeClient(),
    });
    assert.equal(mockGetActiveRun.mock.callCount(), 0);
  });

  it("ignores when text has not changed (metadata-only update)", async () => {
    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { ts: "1700000000.000001", text: "same text" },
        previous_message: { ts: "1700000000.000001", text: "same text" },
      },
      client: makeClient(),
    });
    assert.equal(mockGetActiveRun.mock.callCount(), 0);
  });

  it("ignores when no active run exists for the thread", async () => {
    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { ts: "1700000000.000001", text: "new text" },
        previous_message: { ts: "1700000000.000001", text: "old text" },
      },
      client: makeClient(),
    });
    assert.equal(mockGetActiveRun.mock.callCount(), 1);
    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("appends edited mention text onto the live run via sendUpdate", async () => {
    const handle = makeFakeRunHandle();
    mockGetActiveRun.mock.mockImplementation(() => handle);
    mockFindSessionByThread.mock.mockImplementation(async () => makeSession("mentions"));

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { ts: "1700000000.000001", text: "<@B001> updated question", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "<@B001> old question" },
      },
      client: makeClient("B001"),
    });

    assert.deepEqual(handle.sendUpdateCalls, ["updated question"]);
    assert.deepEqual(handle.stopCalls, []);
    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("does not append for mentions when bot mention is removed", async () => {
    const handle = makeFakeRunHandle();
    mockGetActiveRun.mock.mockImplementation(() => handle);
    mockFindSessionByThread.mock.mockImplementation(async () => makeSession("mentions"));

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { ts: "1700000000.000001", text: "no mention here", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "<@B001> old question" },
      },
      client: makeClient("B001"),
    });

    assert.deepEqual(handle.sendUpdateCalls, []);
    assert.deepEqual(handle.stopCalls, []);
  });

  it("appends edited DM text onto the live run via sendUpdate", async () => {
    const handle = makeFakeRunHandle();
    mockGetActiveRun.mock.mockImplementation(() => handle);
    mockFindSessionByThread.mock.mockImplementation(async () => makeSession("directMessages"));

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "D001",
        message: { ts: "1700000000.000001", text: "edited DM", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "original DM" },
      },
      client: makeClient(),
    });

    assert.deepEqual(handle.sendUpdateCalls, ["edited DM"]);
    assert.deepEqual(handle.stopCalls, []);
    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("ignores already-settled handles", async () => {
    const handle = makeFakeRunHandle("settled");
    mockGetActiveRun.mock.mockImplementation(() => handle);

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "D001",
        message: { ts: "1700000000.000001", text: "edited DM", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "original DM" },
      },
      client: makeClient(),
    });

    assert.deepEqual(handle.sendUpdateCalls, []);
  });
});

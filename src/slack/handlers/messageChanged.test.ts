import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { InFlightRequest } from "../inFlightRequests.js";
import { registerMessageChangedHandler, type MessageChangedDeps } from "./messageChanged.js";

// ============================================================================
// Helpers
// ============================================================================

const mockProcessMessage = mock.fn<(...args: never[]) => Promise<void>>(async () => {});
const mockGetInFlightRequest = mock.fn<
  (channelId: string, messageTs: string) => InFlightRequest | undefined
>(() => undefined);
const mockDeregisterInFlightRequest = mock.fn<(channelId: string, messageTs: string) => void>();

function makeDeps(): MessageChangedDeps {
  return {
    getConfig: () => ({ directMessages: { enabled: true }, mentions: { enabled: true } }) as never,
    getInFlightRequest: mockGetInFlightRequest,
    deregisterInFlightRequest: mockDeregisterInFlightRequest,
    processMessage: mockProcessMessage as never,
  };
}

interface TestMessageEvent {
  subtype?: string;
  channel?: string;
  message?: { ts?: string; text?: string; user?: string };
  previous_message?: { ts?: string; text?: string };
}

type EventHandler = (args: { event: TestMessageEvent; client: App["client"] }) => Promise<void>;

let capturedHandler: EventHandler;

function makeApp(): App {
  return {
    event: (_eventType: string, handler: EventHandler) => {
      capturedHandler = handler;
    },
  } as App;
}

function makeClient(botUserId = "B001"): App["client"] {
  return {
    auth: {
      test: mock.fn(async () => ({ user_id: botUserId })),
    },
  } as never;
}

function makeInFlightRequest(overrides: Partial<InFlightRequest> = {}): InFlightRequest {
  return {
    abortController: new AbortController(),
    sessionId: "session-1",
    triggerType: "mentions",
    ...overrides,
  };
}

beforeEach(() => {
  mockProcessMessage.mock.resetCalls();
  mockGetInFlightRequest.mock.resetCalls();
  mockDeregisterInFlightRequest.mock.resetCalls();

  // Re-register handler each test
  const app = makeApp();
  registerMessageChangedHandler(app, makeDeps());
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
      event: {
        subtype: undefined,
        channel: "C001",
      },
      client: makeClient(),
    });

    assert.equal(mockGetInFlightRequest.mock.callCount(), 0);
  });

  it("ignores message_changed when messageTs is missing", async () => {
    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { text: "new text" },
      },
      client: makeClient(),
    });

    assert.equal(mockGetInFlightRequest.mock.callCount(), 0);
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

    assert.equal(mockGetInFlightRequest.mock.callCount(), 0);
  });

  it("ignores when no in-flight request exists for the message", async () => {
    mockGetInFlightRequest.mock.mockImplementation(() => undefined);

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { ts: "1700000000.000001", text: "new text" },
        previous_message: { ts: "1700000000.000001", text: "old text" },
      },
      client: makeClient(),
    });

    assert.equal(mockGetInFlightRequest.mock.callCount(), 1);
    assert.equal(mockDeregisterInFlightRequest.mock.callCount(), 0);
  });

  it("aborts and deregisters in-flight request when text changes", async () => {
    const inFlight = makeInFlightRequest({ triggerType: "mentions" });
    mockGetInFlightRequest.mock.mockImplementation(() => inFlight);

    const client = makeClient("B001");

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { ts: "1700000000.000001", text: "<@B001> updated question", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "<@B001> old question" },
      },
      client,
    });

    assert.equal(mockDeregisterInFlightRequest.mock.callCount(), 1);
    assert.equal(inFlight.abortController.signal.aborted, true);
  });

  it("restarts with cleaned text for mentions trigger", async () => {
    const inFlight = makeInFlightRequest({ triggerType: "mentions" });
    mockGetInFlightRequest.mock.mockImplementation(() => inFlight);

    const client = makeClient("B001");

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { ts: "1700000000.000001", text: "<@B001> updated question", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "<@B001> old question" },
      },
      client,
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    interface ProcessMessageArg {
      messageText: string;
      channelId: string;
      messageTs: string;
      userId: string;
      triggerType: string;
    }
    const args = mockProcessMessage.mock.calls[0]!.arguments[0] as ProcessMessageArg;
    assert.equal(args.messageText, "updated question");
    assert.equal(args.channelId, "C001");
    assert.equal(args.messageTs, "1700000000.000001");
    assert.equal(args.userId, "U001");
    assert.equal(args.triggerType, "mentions");
  });

  it("does not restart for mentions when bot mention is removed", async () => {
    const inFlight = makeInFlightRequest({ triggerType: "mentions" });
    mockGetInFlightRequest.mock.mockImplementation(() => inFlight);

    const client = makeClient("B001");

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { ts: "1700000000.000001", text: "no mention here", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "<@B001> old question" },
      },
      client,
    });

    // Should still abort, but not restart
    assert.equal(mockDeregisterInFlightRequest.mock.callCount(), 1);
    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("does not restart for mentions when text after mention is empty", async () => {
    const inFlight = makeInFlightRequest({ triggerType: "mentions" });
    mockGetInFlightRequest.mock.mockImplementation(() => inFlight);

    const client = makeClient("B001");

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "C001",
        message: { ts: "1700000000.000001", text: "<@B001>", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "<@B001> old question" },
      },
      client,
    });

    assert.equal(mockDeregisterInFlightRequest.mock.callCount(), 1);
    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("restarts with new text for directMessages trigger", async () => {
    const inFlight = makeInFlightRequest({ triggerType: "directMessages" });
    mockGetInFlightRequest.mock.mockImplementation(() => inFlight);

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "D001",
        message: { ts: "1700000000.000001", text: "edited DM", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "original DM" },
      },
      client: makeClient(),
    });

    assert.equal(mockProcessMessage.mock.callCount(), 1);
    interface ProcessMessageArg {
      messageText: string;
      triggerType: string;
    }
    const args = mockProcessMessage.mock.calls[0]!.arguments[0] as ProcessMessageArg;
    assert.equal(args.messageText, "edited DM");
    assert.equal(args.triggerType, "directMessages");
  });

  it("does not restart for directMessages when new text is empty", async () => {
    const inFlight = makeInFlightRequest({ triggerType: "directMessages" });
    mockGetInFlightRequest.mock.mockImplementation(() => inFlight);

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "D001",
        message: { ts: "1700000000.000001", text: "   ", user: "U001" },
        previous_message: { ts: "1700000000.000001", text: "original DM" },
      },
      client: makeClient(),
    });

    assert.equal(mockDeregisterInFlightRequest.mock.callCount(), 1);
    assert.equal(mockProcessMessage.mock.callCount(), 0);
  });

  it("handles missing previous_message gracefully", async () => {
    const inFlight = makeInFlightRequest({ triggerType: "directMessages" });
    mockGetInFlightRequest.mock.mockImplementation(() => inFlight);

    await capturedHandler({
      event: {
        subtype: "message_changed",
        channel: "D001",
        message: { ts: "1700000000.000001", text: "new text", user: "U001" },
        // no previous_message
      },
      client: makeClient(),
    });

    // previous text defaults to "", which differs from "new text", so it proceeds
    assert.equal(mockDeregisterInFlightRequest.mock.callCount(), 1);
    assert.equal(mockProcessMessage.mock.callCount(), 1);
  });
});

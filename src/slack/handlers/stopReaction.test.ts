import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { registerStopReactionHandler, type StopReactionDeps } from "./stopReaction.js";
import type { Config } from "../../config.js";
import type { StopResult } from "../stopPipeline.js";

interface ReactionEvent {
  reaction: string;
  user: string;
  item: { type: "message" | "file"; channel: string; ts: string };
}

type EventHandler = (args: { event: ReactionEvent; client: App["client"] }) => Promise<void>;

const mockStopThread = mock.fn<
  (channel: string, threadTs: string, userId: string, reason: string) => Promise<StopResult>
>(async () => ({ queryAborted: 0, workerAborted: false, sessionDisengaged: false }));

let resolvedThreadTs = "thread-default";
const mockResolveThreadTs = mock.fn<
  (client: App["client"], channel: string, ts: string) => Promise<string>
>(async () => resolvedThreadTs);

let configOverride: { trigger: string; stop: string | null | undefined } = {
  trigger: "robot_face",
  stop: "octagonal_sign",
};

function makeConfig(): Config {
  return {
    reactions: {
      trigger: configOverride.trigger,
      stop: configOverride.stop,
    },
  } as Config;
}

function makeDeps(): StopReactionDeps {
  return {
    getConfig: () => makeConfig(),
    stopThread: mockStopThread,
    resolveThreadTs: mockResolveThreadTs,
  };
}

let captured: EventHandler | null = null;

function makeApp(): App {
  return {
    event: (_type: string, handler: EventHandler) => {
      captured = handler;
    },
  } as App;
}

function dummyClient(): App["client"] {
  const stub: object = {};
  const client = stub as App["client"];
  return client;
}

function reactionEvent(overrides: Partial<ReactionEvent> = {}): ReactionEvent {
  return {
    reaction: "octagonal_sign",
    user: "U1",
    item: { type: "message", channel: "C1", ts: "1000.001" },
    ...overrides,
  };
}

beforeEach(() => {
  mockStopThread.mock.resetCalls();
  mockResolveThreadTs.mock.resetCalls();
  resolvedThreadTs = "thread-default";
  configOverride = { trigger: "robot_face", stop: "octagonal_sign" };
  captured = null;
  registerStopReactionHandler(makeApp(), makeDeps());
});

describe("registerStopReactionHandler", () => {
  it("resolves the thread and calls stopThread with reason 'stopped via reaction'", async () => {
    resolvedThreadTs = "900.001";
    await captured!({ event: reactionEvent(), client: dummyClient() });

    assert.equal(mockStopThread.mock.callCount(), 1);
    const args = mockStopThread.mock.calls[0]?.arguments;
    assert.equal(args?.[0], "C1");
    assert.equal(args?.[1], "900.001");
    assert.equal(args?.[2], "U1");
    assert.equal(args?.[3], "stopped via reaction");
  });

  it("uses the message ts directly when it is not in a thread (resolver falls back)", async () => {
    resolvedThreadTs = "1000.001";
    await captured!({ event: reactionEvent(), client: dummyClient() });
    assert.equal(mockStopThread.mock.calls[0]?.arguments[1], "1000.001");
  });

  it("ignores non-stop reactions", async () => {
    await captured!({ event: reactionEvent({ reaction: "heart" }), client: dummyClient() });
    assert.equal(mockStopThread.mock.callCount(), 0);
    assert.equal(mockResolveThreadTs.mock.callCount(), 0);
  });

  it("ignores non-message reactions (e.g., file reactions)", async () => {
    await captured!({
      event: reactionEvent({ item: { type: "file", channel: "C1", ts: "1000.001" } }),
      client: dummyClient(),
    });
    assert.equal(mockStopThread.mock.callCount(), 0);
    assert.equal(mockResolveThreadTs.mock.callCount(), 0);
  });

  it("does nothing when config.reactions.stop is null", async () => {
    configOverride = { trigger: "robot_face", stop: null };
    captured = null;
    registerStopReactionHandler(makeApp(), makeDeps());
    await captured!({ event: reactionEvent(), client: dummyClient() });
    assert.equal(mockStopThread.mock.callCount(), 0);
    assert.equal(mockResolveThreadTs.mock.callCount(), 0);
  });

  it("does nothing when config.reactions.stop is empty string", async () => {
    configOverride = { trigger: "robot_face", stop: "" };
    captured = null;
    registerStopReactionHandler(makeApp(), makeDeps());
    await captured!({ event: reactionEvent(), client: dummyClient() });
    assert.equal(mockStopThread.mock.callCount(), 0);
  });

  it("matches a custom stop emoji name", async () => {
    configOverride = { trigger: "robot_face", stop: "clack-stop" };
    captured = null;
    registerStopReactionHandler(makeApp(), makeDeps());
    await captured!({ event: reactionEvent({ reaction: "clack-stop" }), client: dummyClient() });
    assert.equal(mockStopThread.mock.callCount(), 1);
  });

  it("applies regardless of reactor identity (no role check)", async () => {
    for (const user of ["U-member", "U-dev", "U-admin", "U-owner"]) {
      await captured!({ event: reactionEvent({ user }), client: dummyClient() });
    }
    assert.equal(mockStopThread.mock.callCount(), 4);
  });
});

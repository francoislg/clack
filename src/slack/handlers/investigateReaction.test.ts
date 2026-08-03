import { describe, it, vi, beforeEach, expect } from "vitest";
import * as assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type { Config } from "../../config.js";
import { type getConfig } from "../../config.js";
import { type bootstrapInvestigation } from "../../investigations/engine.js";
import { type getOwnerUserId, type sendOwnerDm } from "../ownerDm.js";
import {
  handleInvestigateReaction,
  registerInvestigateReactionHandler,
  type InvestigateReactionDeps,
} from "./investigateReaction.js";

function makeConfig(investigationsEnabled = true, emoji = "mag"): Config {
  const partial: Partial<Config> = {
    investigations: investigationsEnabled ? { enabled: true, emoji } : undefined,
  };
  return partial as Config;
}

const mockPostEphemeralFn = vi.fn(async () => ({ ok: true }));
const mockRepliesFn = vi.fn(async () => ({
  ok: true,
  messages: [{ ts: "1700000000.000001", thread_ts: "1700000000.000001" }],
}));
const mockHistoryFn = vi.fn(async () => ({ ok: true, messages: [] }));

function makeClient(): App["client"] {
  const client = new WebClient();
  vi.spyOn(client.conversations, "replies").mockImplementation(mockRepliesFn);
  vi.spyOn(client.conversations, "history").mockImplementation(mockHistoryFn);
  vi.spyOn(client.conversations, "info").mockResolvedValue({ ok: false });
  vi.spyOn(client.chat, "postEphemeral").mockImplementation(mockPostEphemeralFn);
  return client;
}

function makeEvent(reaction: string, user: string, type = "message") {
  return {
    reaction,
    user,
    item: { type, channel: "C001", ts: "1700000000.000001" },
  };
}

type EventHandler = (args: {
  event: ReturnType<typeof makeEvent>;
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

function makeDeps(
  overrides: {
    getConfig?: ReturnType<typeof vi.fn>;
    bootstrapInvestigation?: ReturnType<typeof vi.fn>;
    getOwnerUserId?: ReturnType<typeof vi.fn>;
    sendOwnerDm?: ReturnType<typeof vi.fn>;
  } = {},
): InvestigateReactionDeps {
  const getConfigFn = overrides.getConfig ?? vi.fn(() => makeConfig());
  const bootstrapInvestigationFn =
    overrides.bootstrapInvestigation ??
    vi.fn(async () => ({
      status: "ok" as const,
      sessionId: "S001",
      mainChannel: "C002",
    }));
  const getOwnerUserIdFn = overrides.getOwnerUserId ?? vi.fn(async () => null);
  const sendOwnerDmFn = overrides.sendOwnerDm ?? vi.fn(async () => true);

  return {
    getConfig: getConfigFn as typeof getConfig,
    bootstrapInvestigation: bootstrapInvestigationFn as typeof bootstrapInvestigation,
    getOwnerUserId: getOwnerUserIdFn as typeof getOwnerUserId,
    sendOwnerDm: sendOwnerDmFn as typeof sendOwnerDm,
  };
}

beforeEach(() => {
  mockPostEphemeralFn.mockClear();
  mockRepliesFn.mockClear();
  mockHistoryFn.mockClear();
  mockRepliesFn.mockImplementation(async () => ({
    ok: true,
    messages: [{ ts: "1700000000.000001", thread_ts: "1700000000.000001" }],
  }));
  mockHistoryFn.mockImplementation(async () => ({ ok: true, messages: [] }));
  mockPostEphemeralFn.mockImplementation(async () => ({ ok: true }));
});

describe("handleInvestigateReaction", () => {
  it("returns immediately if investigations are disabled", async () => {
    const deps = makeDeps({
      getConfig: vi.fn(() => makeConfig(false)),
    });

    const client = makeClient();
    await handleInvestigateReaction(makeEvent("mag", "U001"), client, deps);

    const bootstrapMock = vi.mocked(deps.bootstrapInvestigation);
    assert.equal(bootstrapMock.mock.calls.length, 0);
  });

  it("returns immediately if emoji doesn't match", async () => {
    const deps = makeDeps({
      getConfig: vi.fn(() => makeConfig(true, "mag")),
    });

    const client = makeClient();
    await handleInvestigateReaction(makeEvent("thumbsup", "U001"), client, deps);

    const bootstrapMock = vi.mocked(deps.bootstrapInvestigation);
    assert.equal(bootstrapMock.mock.calls.length, 0);
  });

  it("returns if reaction is not on a message", async () => {
    const deps = makeDeps();
    const client = makeClient();

    await handleInvestigateReaction(makeEvent("mag", "U001", "file"), client, deps);

    const bootstrapMock = vi.mocked(deps.bootstrapInvestigation);
    assert.equal(bootstrapMock.mock.calls.length, 0);
  });

  it("posts ephemeral if origin thread can't be resolved", async () => {
    mockRepliesFn.mockImplementation(async () => ({ ok: true, messages: [] }));
    mockHistoryFn.mockImplementation(async () => ({ ok: true, messages: [] }));

    const deps = makeDeps();
    const client = makeClient();

    await handleInvestigateReaction(makeEvent("mag", "U001"), client, deps);

    expect(mockPostEphemeralFn).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C001", user: "U001" }),
    );
  });

  it("bootstrap ok status (non-degraded): does not post reactor ephemeral", async () => {
    const deps = makeDeps({
      bootstrapInvestigation: vi.fn(async () => ({
        status: "ok" as const,
        sessionId: "S001",
        mainChannel: "C002",
        permalink: "https://example.slack.com/archives/C002/p1234",
        degraded: false,
      })),
    });

    const client = makeClient();
    await handleInvestigateReaction(makeEvent("mag", "U001"), client, deps);

    expect(mockPostEphemeralFn).not.toHaveBeenCalled();
  });

  it("bootstrap ok status (degraded): sends owner DM, no reactor ephemeral", async () => {
    const mockGetOwnerUserId = vi.fn(async () => "U_OWNER");
    const mockSendOwnerDm = vi.fn(async () => true);

    const deps = makeDeps({
      bootstrapInvestigation: vi.fn(async () => ({
        status: "ok" as const,
        sessionId: "S001",
        mainChannel: "C002",
        degraded: true,
      })),
      getOwnerUserId: mockGetOwnerUserId,
      sendOwnerDm: mockSendOwnerDm,
    });

    const client = makeClient();
    await handleInvestigateReaction(makeEvent("mag", "U001"), client, deps);

    expect(mockGetOwnerUserId).toHaveBeenCalledTimes(1);
    expect(mockSendOwnerDm).toHaveBeenCalledWith("U_OWNER", expect.stringContaining("<#C001>"));
    expect(mockPostEphemeralFn).not.toHaveBeenCalled();
  });

  it("duplicate status: posts reactor ephemeral with permalink", async () => {
    const deps = makeDeps({
      bootstrapInvestigation: vi.fn(async () => ({
        status: "duplicate" as const,
        permalink: "https://example.slack.com/archives/C002/p1234",
      })),
    });

    const client = makeClient();
    await handleInvestigateReaction(makeEvent("mag", "U001"), client, deps);

    expect(mockPostEphemeralFn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("already being investigated"),
      }),
    );
  });

  it("duplicate status: posts reactor ephemeral without permalink", async () => {
    const deps = makeDeps({
      bootstrapInvestigation: vi.fn(async () => ({
        status: "duplicate" as const,
      })),
    });

    const client = makeClient();
    await handleInvestigateReaction(makeEvent("mag", "U001"), client, deps);

    expect(mockPostEphemeralFn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("already being investigated"),
      }),
    );
  });

  it("channel_not_configured: sends owner DM and posts reactor ephemeral", async () => {
    const mockGetOwnerUserId = vi.fn(async () => "U_OWNER");
    const mockSendOwnerDm = vi.fn(async () => true);

    const deps = makeDeps({
      bootstrapInvestigation: vi.fn(async () => ({
        status: "channel_not_configured" as const,
      })),
      getOwnerUserId: mockGetOwnerUserId,
      sendOwnerDm: mockSendOwnerDm,
    });

    const client = makeClient();
    await handleInvestigateReaction(makeEvent("mag", "U001"), client, deps);

    expect(mockGetOwnerUserId).toHaveBeenCalledTimes(1);
    expect(mockSendOwnerDm).toHaveBeenCalledWith("U_OWNER", expect.stringContaining("<@U001>"));

    expect(mockPostEphemeralFn).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C001", user: "U001" }),
    );
  });

  it("cycle status: posts reactor ephemeral", async () => {
    const deps = makeDeps({
      bootstrapInvestigation: vi.fn(async () => ({
        status: "cycle" as const,
      })),
    });

    const client = makeClient();
    await handleInvestigateReaction(makeEvent("mag", "U001"), client, deps);

    expect(mockPostEphemeralFn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("can't investigate"),
      }),
    );
  });

  it("dm_failed status: logs warning, no user-facing message", async () => {
    const deps = makeDeps({
      bootstrapInvestigation: vi.fn(async () => ({
        status: "dm_failed" as const,
      })),
    });

    const client = makeClient();
    await handleInvestigateReaction(makeEvent("mag", "U001"), client, deps);

    assert.equal(mockPostEphemeralFn.mock.calls.length, 0);
  });
});

describe("registerInvestigateReactionHandler", () => {
  it("registers a reaction_added event handler", () => {
    const app = makeApp();
    registerInvestigateReactionHandler(app);
    assert.ok(capturedHandler, "handler should have been registered");
  });

  it("wraps handler in try/catch", async () => {
    const app = makeApp();
    registerInvestigateReactionHandler(app);

    mockRepliesFn.mockRejectedValue(new Error("bootstrap failed"));

    const client = makeClient();

    await capturedHandler({
      event: makeEvent("mag", "U001"),
      client,
    });

    assert.ok(true, "handler did not throw");
  });
});

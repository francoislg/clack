import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { SlackEventMiddlewareArgs } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type { Config } from "../../config.js";
import type { SessionContext } from "../../sessions.js";
import type { AutoRespondRule } from "../../autoRespond.js";
import { loadRules, findMatchingRule } from "../../autoRespond.js";
import type {
  runPreAnalysis,
  runChannelContinuationPreAnalysis,
} from "../../claude/preAnalysis.js";
import type { EphemeralRule } from "../../ephemeralRules.js";
import {
  resolveAutoRespondContext,
  handleAutoRespondMessageEvent,
  type AutoRespondDeps,
  type AutoRespondMessageDeps,
} from "./autoRespond.js";

vi.mock(import("../../autoRespond.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  loadRules: vi.fn(),
  findMatchingRule: vi.fn(),
}));

const NOW = new Date("2026-07-27T13:22:03Z").getTime();
const NOW_SEC = (NOW / 1000).toFixed(6);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeClient(): WebClient {
  const client: WebClient = Object.create(WebClient.prototype);
  Object.assign(client, {
    conversations: {
      history: vi.fn(async () => ({ messages: [] })),
      replies: vi.fn(async () => ({ messages: [] })),
      info: vi.fn(async () => ({ channel: { name: "dev-team" } })),
    },
    users: { info: vi.fn(async () => ({ user: { name: "steph", profile: {} } })) },
    auth: { test: vi.fn(async () => ({ user_id: "U_BOT", bot_id: "B_BOT" })) },
    chat: { getPermalink: vi.fn(async () => ({ permalink: "https://slack/link" })) },
  });
  return client;
}

function makeConfig(): Config {
  return {
    threadAutoRespond: true,
    autoRespond: { enabled: true },
    slackApp: { name: "Clack" },
  } as Config;
}

function makeRule(overrides: Partial<AutoRespondRule> = {}): AutoRespondRule {
  return {
    id: "rule-1",
    channels: ["C001"],
    preAnalysisContext: "Only answer product questions",
    enabled: true,
    ...overrides,
  };
}

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "sess-1",
    channelId: "C001",
    messageTs: "1785158000.000000",
    threadTs: "1785158000.000000",
    userId: "U_USER",
    trigger: {
      type: "mentions",
      userId: "U_USER",
      messageTs: "1785158000.000000",
      messageText: "test",
    },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: NOW,
    createdAt: NOW,
    attentionLevel: "medium",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AutoRespondDeps> = {}): AutoRespondDeps {
  return {
    findSession: async () => null,
    setAttentionLevel: vi.fn(async () => {}),
    preAnalysis: vi.fn(async () => "respond" as const),
    activeRunPreAnalysis: vi.fn(async () => "append" as const),
    loadSharedContext: () => "",
    getActiveRun: () => undefined,
    getEphemeralRule: async () => null,
    channelContinuationPreAnalysis: vi.fn(async () => "respond" as const),
    ratchetEphemeralRule: vi.fn(async () => null),
    renewEphemeralRule: vi.fn(async () => null),
    deleteEphemeralRule: vi.fn(async () => true),
    ...overrides,
  };
}

function ephemeralRule(overrides: Partial<EphemeralRule> = {}): EphemeralRule {
  return {
    id: "eph-1",
    kind: "ephemeral",
    channels: ["C001"],
    attentionLevel: "medium",
    expiresAt: NOW + 30 * 60 * 1000,
    sessionIds: ["anchor-sess"],
    anchorText: "Deploy digest for today",
    enabled: true,
    ...overrides,
  };
}

function imageFile(id = "F1") {
  return {
    id,
    name: "screenshot.png",
    mimetype: "image/png",
    size: 2048,
    url_private: `https://files.slack.com/${id}.png`,
  };
}

/** Top-level (no `thread_ts`), which routes to the standing-rule path. */
function callTopLevel(deps: AutoRespondDeps, text: string | undefined, rawFiles?: unknown[]) {
  return resolveAutoRespondContext(
    "C001",
    NOW_SEC,
    "U_USER",
    undefined,
    text,
    undefined,
    makeConfig(),
    makeClient(),
    "U_BOT",
    "B_BOT",
    deps,
    rawFiles,
  );
}

describe("resolveAutoRespondContext — standing-rule path with attachments", () => {
  beforeEach(() => {
    vi.mocked(loadRules).mockResolvedValue([makeRule()]);
    vi.mocked(findMatchingRule).mockResolvedValue(makeRule());
  });

  it("runs pre-analysis on a file-bearing message that carries text", async () => {
    const preAnalysis = vi.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({ preAnalysis });

    const context = await callTopLevel(deps, "Kristen did not get her celebration", [imageFile()]);

    assert.equal(preAnalysis.mock.calls[0]?.[0], "Kristen did not get her celebration");
    assert.equal(context?.triggerType, "autoRespond");
    assert.equal(context?.ruleName, "rule-1");
  });

  it("synthesizes analysis text for an image-only message instead of dropping it", async () => {
    const preAnalysis = vi.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({ preAnalysis });

    const context = await callTopLevel(deps, "   ", [imageFile()]);

    assert.equal(preAnalysis.mock.calls.length, 1);
    const analyzedText = preAnalysis.mock.calls[0]?.[0] as string;
    assert.ok(analyzedText.length > 0, "expected synthesized placeholder text");
    assert.notEqual(analyzedText.trim(), "");
    assert.equal(context?.triggerType, "autoRespond");
  });

  it("still drops a message with neither text nor attachments", async () => {
    const preAnalysis = vi.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({ preAnalysis });

    const context = await callTopLevel(deps, "", undefined);

    assert.equal(context, null);
    assert.equal(preAnalysis.mock.calls.length, 0);
  });

  it("ignores non-image attachments when deciding whether text can be synthesized", async () => {
    const preAnalysis = vi.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({ preAnalysis });

    const context = await callTopLevel(deps, undefined, [
      { id: "F2", name: "a.zip", mimetype: "application/zip", size: 10, url_private: "u" },
    ]);

    assert.equal(context, null);
    assert.equal(preAnalysis.mock.calls.length, 0);
  });

  it("synthesizes analysis text for an image-only message on the ephemeral path", async () => {
    const channelContinuationPreAnalysis = vi.fn<typeof runChannelContinuationPreAnalysis>(
      async () => "respond" as const,
    );
    const deps = makeDeps({
      getEphemeralRule: async () => ephemeralRule(),
      channelContinuationPreAnalysis,
      renewEphemeralRule: vi.fn(async () => ephemeralRule()),
    });

    const context = await callTopLevel(deps, "   ", [imageFile()]);

    assert.equal(channelContinuationPreAnalysis.mock.calls.length, 1);
    const analyzedText = channelContinuationPreAnalysis.mock.calls[0]?.[0] as string;
    assert.ok(analyzedText.length > 0, "expected synthesized placeholder text");
    assert.equal(context?.triggerType, "channelReply");
  });

  it("resolves the thread path for a file-bearing reply on an engaged session", async () => {
    const preAnalysis = vi.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({ findSession: async () => session(), preAnalysis });

    const context = await resolveAutoRespondContext(
      "C001",
      NOW_SEC,
      "U_USER",
      undefined,
      "here's the screenshot",
      "1785158000.000000",
      makeConfig(),
      makeClient(),
      "U_BOT",
      "B_BOT",
      deps,
      [imageFile()],
    );

    assert.equal(context?.triggerType, "threadReply");
    assert.equal(preAnalysis.mock.calls[0]?.[0], "here's the screenshot");
  });
});

// ---------------------------------------------------------------------------
// Subtype admission at the listener boundary
// ---------------------------------------------------------------------------

type MessageEvent = SlackEventMiddlewareArgs<"message">["event"];

describe("handleAutoRespondMessageEvent — subtype admission", () => {
  /** `botUserId: ""` makes the handler bail immediately after the identity lookup, so the
   *  lookup's call count reports whether the event survived the subtype gate. */
  function makeMessageDeps(): AutoRespondMessageDeps {
    return {
      getConfig: vi.fn(() => makeConfig()),
      getBotIdentity: vi.fn(async () => ({ botUserId: "", botId: undefined })),
    };
  }

  function eventWithSubtype(subtype: string | undefined): MessageEvent {
    return {
      type: "message",
      subtype,
      channel_type: "channel",
      channel: "C001",
      ts: NOW_SEC,
      event_ts: NOW_SEC,
      user: "U_USER",
      text: "hello",
      files: [imageFile()],
    } as MessageEvent;
  }

  async function admitted(subtype: string | undefined): Promise<boolean> {
    const deps = makeMessageDeps();
    await handleAutoRespondMessageEvent(eventWithSubtype(subtype), makeClient(), deps);
    return vi.mocked(deps.getBotIdentity).mock.calls.length === 1;
  }

  it("admits the subtypes that still denote a real message", async () => {
    for (const subtype of [
      undefined,
      "bot_message",
      "file_share",
      "thread_broadcast",
      "me_message",
    ]) {
      assert.equal(await admitted(subtype), true, `expected ${subtype} to be admitted`);
    }
  });

  it("discards hidden meta and channel-lifecycle subtypes", async () => {
    for (const subtype of [
      "message_changed",
      "message_deleted",
      "message_replied",
      "channel_join",
      "channel_leave",
      "channel_topic",
    ]) {
      assert.equal(await admitted(subtype), false, `expected ${subtype} to be discarded`);
    }
  });
});

import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { resolveAutoRespondContext, type AutoRespondDeps } from "./autoRespond.js";
import type { EphemeralRule } from "../../ephemeralRules.js";
import type { Config } from "../../config.js";
import { WebClient } from "@slack/web-api";

const NOW = new Date("2026-07-03T12:00:00Z").getTime();

function makeClient(): WebClient {
  const client: WebClient = Object.create(WebClient.prototype);
  Object.assign(client, {
    conversations: {
      history: vi.fn(async () => ({
        messages: [{ user: "U_BOT", text: "Deploy digest", ts: String(NOW / 1000 - 120) }],
      })),
      replies: vi.fn(async () => ({ messages: [] })),
      info: vi.fn(async () => ({ channel: { name: "general" } })),
    },
    users: {
      info: vi.fn(async () => ({ user: { name: "alice", profile: {} } })),
    },
    auth: {
      test: vi.fn(async () => ({ user_id: "U_BOT", bot_id: "B_BOT" })),
    },
    chat: {
      getPermalink: vi.fn(async () => ({ permalink: "https://slack/link" })),
    },
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

function rule(overrides: Partial<EphemeralRule> = {}): EphemeralRule {
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

function makeDeps(overrides: Partial<AutoRespondDeps> = {}): AutoRespondDeps {
  return {
    findSession: async () => null,
    setAttentionLevel: vi.fn(async () => {}),
    preAnalysis: vi.fn(async () => "respond" as const),
    activeRunPreAnalysis: vi.fn(async () => "append" as const),
    loadSharedContext: () => "",
    getActiveRun: () => undefined,
    getEphemeralRule: async () => rule(),
    channelContinuationPreAnalysis: vi.fn(async () => "respond" as const),
    ratchetEphemeralRule: vi.fn(async () => null),
    renewEphemeralRule: vi.fn(async () => null),
    deleteEphemeralRule: vi.fn(async () => true),
    ...overrides,
  };
}

function call(deps: AutoRespondDeps, text = "what about staging?") {
  return resolveAutoRespondContext(
    "C001",
    String(NOW / 1000),
    "U_USER",
    undefined,
    text,
    undefined,
    makeConfig(),
    makeClient(),
    "U_BOT",
    "B_BOT",
    deps,
    undefined,
  );
}

describe("resolveAutoRespondContext — ephemeral channel conversations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("respond within window: renews the rule and continues the anchor session", async () => {
    const renewEphemeralRule = vi.fn<AutoRespondDeps["renewEphemeralRule"]>(async () => null);
    const deps = makeDeps({
      channelContinuationPreAnalysis: vi.fn(async () => "respond" as const),
      renewEphemeralRule,
    });

    const result = await call(deps);

    assert.ok(result);
    assert.equal(result.triggerType, "channelReply");
    assert.equal(result.resumeSessionId, "anchor-sess");
    assert.equal(result.preAnalysis, "channel-respond");
    assert.ok(result.additionalSystemPrompt?.includes("PLACEMENT"));
    assert.equal(renewEphemeralRule.mock.calls.length, 1);
    assert.equal(renewEphemeralRule.mock.calls[0][0], "eph-1");
  });

  it("skip within window: ratchets one rung, no deletion", async () => {
    const ratchetEphemeralRule = vi.fn(async () => null);
    const deleteEphemeralRule = vi.fn(async () => true);
    const deps = makeDeps({
      channelContinuationPreAnalysis: vi.fn(async () => "skip" as const),
      ratchetEphemeralRule,
      deleteEphemeralRule,
    });

    const result = await call(deps);

    assert.equal(result, null);
    assert.equal(ratchetEphemeralRule.mock.calls.length, 1);
    assert.equal(deleteEphemeralRule.mock.calls.length, 0);
  });

  it("skip past expiry (dormant): deletes without ratcheting", async () => {
    const ratchetEphemeralRule = vi.fn(async () => null);
    const deleteEphemeralRule = vi.fn(async () => true);
    const deps = makeDeps({
      getEphemeralRule: async () => rule({ expiresAt: NOW - 60 * 1000 }),
      channelContinuationPreAnalysis: vi.fn(async () => "skip" as const),
      ratchetEphemeralRule,
      deleteEphemeralRule,
    });

    const result = await call(deps);

    assert.equal(result, null);
    assert.equal(ratchetEphemeralRule.mock.calls.length, 0);
    assert.equal(deleteEphemeralRule.mock.calls.length, 1);
  });

  it("respond past expiry: revives the dormant conversation", async () => {
    const renewEphemeralRule = vi.fn(async () => null);
    const deps = makeDeps({
      getEphemeralRule: async () => rule({ expiresAt: NOW - 15 * 60 * 60 * 1000 }),
      channelContinuationPreAnalysis: vi.fn(async () => "respond" as const),
      renewEphemeralRule,
    });

    const result = await call(deps);

    assert.ok(result);
    assert.equal(result.triggerType, "channelReply");
    assert.equal(renewEphemeralRule.mock.calls.length, 1);
  });

  it("stop: deletes the rule", async () => {
    const deleteEphemeralRule = vi.fn(async () => true);
    const deps = makeDeps({
      channelContinuationPreAnalysis: vi.fn(async () => "stop" as const),
      deleteEphemeralRule,
    });

    const result = await call(deps);

    assert.equal(result, null);
    assert.equal(deleteEphemeralRule.mock.calls.length, 1);
  });

  it("classifier failure (null): leaves the rule untouched", async () => {
    const ratchetEphemeralRule = vi.fn(async () => null);
    const renewEphemeralRule = vi.fn(async () => null);
    const deleteEphemeralRule = vi.fn(async () => true);
    const deps = makeDeps({
      channelContinuationPreAnalysis: vi.fn(async () => null),
      ratchetEphemeralRule,
      renewEphemeralRule,
      deleteEphemeralRule,
    });

    const result = await call(deps);

    assert.equal(result, null);
    assert.equal(ratchetEphemeralRule.mock.calls.length, 0);
    assert.equal(renewEphemeralRule.mock.calls.length, 0);
    assert.equal(deleteEphemeralRule.mock.calls.length, 0);
  });

  it("empty message with no attachments: no judge call, rule untouched", async () => {
    const judge = vi.fn(async () => "respond" as const);
    const deps = makeDeps({ channelContinuationPreAnalysis: judge });

    const result = await call(deps, "");

    assert.equal(result, null);
    assert.equal(judge.mock.calls.length, 0);
  });

  it("judge receives the anchor text and current level", async () => {
    const judge = vi.fn<AutoRespondDeps["channelContinuationPreAnalysis"]>(
      async () => "skip" as const,
    );
    const deps = makeDeps({
      getEphemeralRule: async () => rule({ attentionLevel: "low" }),
      channelContinuationPreAnalysis: judge,
    });

    await call(deps);

    assert.equal(judge.mock.calls[0][3], "Deploy digest for today");
    assert.equal(judge.mock.calls[0][4], "low");
  });

  it("ledger hint appears in the prompt when linked sessions exist", async () => {
    const deps = makeDeps({
      getEphemeralRule: async () => rule({ sessionIds: ["anchor-sess", "thread-sess"] }),
    });

    const result = await call(deps);

    assert.ok(result?.additionalSystemPrompt?.includes("2 linked sessions"));
    assert.ok(result?.additionalSystemPrompt?.includes("find_sessions"));
  });

  it("creationContext from the seed lands in the prompt", async () => {
    const deps = makeDeps({
      getEphemeralRule: async () => rule({ creationContext: "keep it playful" }),
    });

    const result = await call(deps);

    assert.ok(result?.additionalSystemPrompt?.includes("keep it playful"));
  });

  it("no ephemeral rule: falls through to standing-rule matching", async () => {
    const judge = vi.fn(async () => "respond" as const);
    const deps = makeDeps({
      getEphemeralRule: async () => null,
      channelContinuationPreAnalysis: judge,
    });

    const result = await call(deps);

    assert.equal(result, null);
    assert.equal(judge.mock.calls.length, 0);
  });
});

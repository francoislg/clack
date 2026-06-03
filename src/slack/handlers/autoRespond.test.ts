import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { Config } from "../../config.js";
import type { SessionContext } from "../../sessions.js";
import { resolveAutoRespondContext, type AutoRespondDeps } from "./autoRespond.js";
import type { runPreAnalysis, runActiveRunPreAnalysis } from "../../claude/preAnalysis.js";
import type { ClaudeRunHandle } from "../../claude/runHandle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(replyMessages: Array<{ user?: string; text?: string; ts?: string }> = []) {
  return {
    conversations: {
      replies: vi.fn(async () => ({ messages: replyMessages })),
      info: vi.fn(async () => ({ channel: { name: "test" } })),
    },
    users: {
      info: vi.fn(async () => ({ user: { name: "test", profile: {} } })),
    },
    auth: {
      test: vi.fn(async () => ({ user_id: "U_BOT", bot_id: "B_BOT" })),
    },
  } as never;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    threadAutoRespond: true,
    slackApp: { name: "Clack" },
    ...overrides,
  } as Config;
}

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "sess-1",
    channelId: "C001",
    messageTs: "1700000001.000000",
    threadTs: "1700000001.000000",
    userId: "U_USER",
    trigger: {
      type: "mentions",
      userId: "U_USER",
      messageTs: "1700000001.000000",
      messageText: "test",
    },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
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
    ...overrides,
  };
}

function call(
  deps: AutoRespondDeps,
  text: string | undefined = "follow-up question?",
  rawFiles?: unknown[],
) {
  const now = (Date.now() / 1000).toFixed(6);
  const threadTs = (Date.now() / 1000 - 1).toFixed(6);
  return resolveAutoRespondContext(
    "C001",
    now,
    "U_USER",
    undefined,
    text,
    threadTs,
    makeConfig(),
    makeClient(),
    "U_BOT",
    "B_BOT",
    deps,
    rawFiles,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveAutoRespondContext — auto-respond tracking", () => {
  it("evaluates thread reply when session is engaged (attentionLevel medium)", async () => {
    const preAnalysis = vi.fn(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      preAnalysis,
    });

    const result = await call(deps);

    assert.ok(result !== null);
    assert.equal(result?.triggerType, "threadReply");
    assert.equal(preAnalysis.mock.calls.length, 1);
  });

  it("skips thread reply without pre-analysis when disengaged (attentionLevel off)", async () => {
    const preAnalysis = vi.fn(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "off" }),
      preAnalysis,
    });

    const result = await call(deps);

    assert.equal(result, null);
    assert.equal(preAnalysis.mock.calls.length, 0);
  });

  it("disengages session when pre-analysis returns 'stop'", async () => {
    const setAttentionLevel = vi.fn(async (_id: string, _level: string) => {});
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      preAnalysis: async () => "stop",
      setAttentionLevel,
    });

    const result = await call(deps, "let's grab lunch");

    assert.equal(result, null);
    assert.equal(setAttentionLevel.mock.calls.length, 1);
    assert.equal(setAttentionLevel.mock.calls[0][0], "sess-1");
    assert.equal(setAttentionLevel.mock.calls[0][1], "off");
  });

  it("skips message (no disengage) when pre-analysis returns 'skip'", async () => {
    const setAttentionLevel = vi.fn(async () => {});
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      preAnalysis: async () => "skip",
      setAttentionLevel,
    });

    const result = await call(deps, "thanks!");

    assert.equal(result, null);
    assert.equal(setAttentionLevel.mock.calls.length, 0);
  });

  it("does not respond on 'skip' verdict", async () => {
    const setAttentionLevel = vi.fn(async () => {});
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      preAnalysis: async () => "skip",
      setAttentionLevel,
    });

    const result = await call(deps, "thanks!");

    assert.equal(result, null);
    assert.equal(setAttentionLevel.mock.calls.length, 0);
  });

  it("defaults to engaged (medium) when attentionLevel is absent (backward compat)", async () => {
    const preAnalysis = vi.fn(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: undefined }),
      preAnalysis,
    });

    const result = await call(deps);

    // Should proceed to pre-analysis (not skip as disengaged)
    assert.ok(result !== null);
    assert.equal(preAnalysis.mock.calls.length, 1);
  });

  it("responds without pre-analysis when attentionLevel is 'always'", async () => {
    const preAnalysis = vi.fn(async () => "skip" as const);
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "always" }),
      preAnalysis,
    });

    const result = await call(deps);

    assert.ok(result !== null);
    assert.equal(result?.triggerType, "threadReply");
    assert.equal(result?.preAnalysis, "always");
    assert.equal(preAnalysis.mock.calls.length, 0);
  });

  it("forwards the session's attention level to the pre-analysis gate", async () => {
    const preAnalysis = vi.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "high" }),
      preAnalysis,
    });

    await call(deps);

    assert.equal(preAnalysis.mock.calls.length, 1);
    // level is the 11th positional arg (index 10) on runPreAnalysis
    assert.equal(preAnalysis.mock.calls[0][10], "high");
  });

  it("runs pre-analysis for image-only thread reply using synthesized image metadata", async () => {
    const preAnalysis = vi.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      preAnalysis,
    });

    const rawFiles = [
      {
        id: "F1",
        name: "screenshot.png",
        mimetype: "image/png",
        size: 1024,
        url_private: "https://files.slack.com/F1",
      },
    ];

    const result = await call(deps, "", rawFiles);

    assert.ok(result !== null);
    assert.equal(result?.triggerType, "threadReply");
    assert.equal(preAnalysis.mock.calls.length, 1);
    // First arg is the resolved message text — should be the synthesized placeholder
    const messageArg = preAnalysis.mock.calls[0][0];
    assert.ok(messageArg.includes("[attached images:"));
    assert.ok(messageArg.includes("screenshot.png"));
    assert.ok(messageArg.includes("F1"));
  });

  it("disengages on 'stop' verdict for image-only thread reply", async () => {
    const setAttentionLevel = vi.fn(async (_id: string, _level: string) => {});
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      preAnalysis: async () => "stop",
      setAttentionLevel,
    });

    const rawFiles = [
      {
        id: "F2",
        name: "meme.jpg",
        mimetype: "image/jpeg",
        size: 1024,
        url_private: "https://files.slack.com/F2",
      },
    ];

    const result = await call(deps, "", rawFiles);

    assert.equal(result, null);
    assert.equal(setAttentionLevel.mock.calls.length, 1);
    assert.equal(setAttentionLevel.mock.calls[0][1], "off");
  });

  it("skips thread reply with no text and no images (no pre-analysis call)", async () => {
    const preAnalysis = vi.fn(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      preAnalysis,
    });

    const result = await call(deps, "");

    assert.equal(result, null);
    assert.equal(preAnalysis.mock.calls.length, 0);
  });

  it("bails when a stop reaction disengages the session during pre-analysis", async () => {
    let callCount = 0;
    const findSession = vi.fn(async () => {
      callCount += 1;
      return session({ attentionLevel: callCount === 1 ? "medium" : "off" });
    });
    const preAnalysis = vi.fn(async () => "respond" as const);
    const deps = makeDeps({ findSession, preAnalysis });

    const result = await call(deps);

    assert.equal(result, null);
    assert.equal(preAnalysis.mock.calls.length, 1, "pre-analysis should have run once");
    assert.equal(findSession.mock.calls.length, 2, "session should be re-read after pre-analysis");
  });
});

// ---------------------------------------------------------------------------
// secondsSinceLastBotMessage derivation + forwarding to both gates
// ---------------------------------------------------------------------------

/** Client (from makeClient) whose thread-replies fetch returns the supplied messages. */
function clientWithReplies(messages: Array<{ user?: string; text?: string; ts?: string }>) {
  return makeClient(messages);
}

/** Minimal live run handle — only `status` is read by the handler. */
function runningHandle(): ClaudeRunHandle {
  return {
    sendUpdate: async () => {},
    stop: async () => {},
    futureResponse: Promise.resolve({ success: true, answer: "" }),
    status: "running",
    hasPendingInput: () => false,
    consumePendingPushedTexts: () => [],
    hasDelivered: () => false,
  };
}

describe("resolveAutoRespondContext — elapsed-time signal", () => {
  it("derives the gap from the last bot message and forwards it to the thread gate", async () => {
    const nowSec = Date.now() / 1000;
    const preAnalysis = vi.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      preAnalysis,
    });

    await resolveAutoRespondContext(
      "C001",
      nowSec.toFixed(6),
      "U_USER",
      undefined,
      "you there?",
      (nowSec - 300).toFixed(6),
      makeConfig(),
      clientWithReplies([
        { user: "U_OTHER", text: "earlier note", ts: (nowSec - 90).toFixed(6) },
        { user: "U_BOT", text: "here is the answer", ts: (nowSec - 30).toFixed(6) },
      ]),
      "U_BOT",
      "B_BOT",
      deps,
    );

    const gap = preAnalysis.mock.calls[0]?.[8];
    assert.equal(typeof gap, "number");
    assert.ok(Math.abs((gap as number) - 30) < 2, `expected ~30s, got ${gap}`);
  });

  it("forwards undefined when the thread has no prior bot message", async () => {
    const nowSec = Date.now() / 1000;
    const preAnalysis = vi.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      preAnalysis,
    });

    await resolveAutoRespondContext(
      "C001",
      nowSec.toFixed(6),
      "U_USER",
      undefined,
      "you there?",
      (nowSec - 300).toFixed(6),
      makeConfig(),
      clientWithReplies([{ user: "U_OTHER", text: "earlier note", ts: (nowSec - 90).toFixed(6) }]),
      "U_BOT",
      "B_BOT",
      deps,
    );

    assert.equal(preAnalysis.mock.calls[0]?.[8], undefined);
  });

  it("forwards the gap to the active-run gate when a run is live", async () => {
    const nowSec = Date.now() / 1000;
    const activeRunPreAnalysis = vi.fn<typeof runActiveRunPreAnalysis>(
      async () => "append" as const,
    );
    const deps = makeDeps({
      findSession: async () => session({ attentionLevel: "medium" }),
      activeRunPreAnalysis,
      getActiveRun: () => runningHandle(),
    });

    await resolveAutoRespondContext(
      "C001",
      nowSec.toFixed(6),
      "U_USER",
      undefined,
      "Clack, also retry",
      (nowSec - 300).toFixed(6),
      makeConfig(),
      clientWithReplies([{ user: "U_BOT", text: "working on it", ts: (nowSec - 15).toFixed(6) }]),
      "U_BOT",
      "B_BOT",
      deps,
    );

    const gap = activeRunPreAnalysis.mock.calls[0]?.[8];
    assert.equal(typeof gap, "number");
    assert.ok(Math.abs((gap as number) - 15) < 2, `expected ~15s, got ${gap}`);
  });
});

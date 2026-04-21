import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../../config.js";
import type { SessionContext } from "../../sessions.js";
import { resolveAutoRespondContext, type AutoRespondDeps } from "./autoRespond.js";
import type { runPreAnalysis } from "../../claude/preAnalysis.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient() {
  return {
    conversations: {
      replies: mock.fn(async () => ({ messages: [] })),
      info: mock.fn(async () => ({ channel: { name: "test" } })),
    },
    users: {
      info: mock.fn(async () => ({ user: { name: "test", profile: {} } })),
    },
    auth: {
      test: mock.fn(async () => ({ user_id: "U_BOT", bot_id: "B_BOT" })),
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
    originalQuestion: "test",
    threadContext: [],
    refinements: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    autoResponseActive: true,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AutoRespondDeps> = {}): AutoRespondDeps {
  return {
    findSession: async () => null,
    setActive: mock.fn(async () => {}),
    preAnalysis: mock.fn(async () => "respond" as const),
    loadSharedContext: () => "",
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
  it("evaluates thread reply when session has autoResponseActive=true", async () => {
    const preAnalysis = mock.fn(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: true }),
      preAnalysis,
    });

    const result = await call(deps);

    assert.ok(result !== null);
    assert.equal(result?.triggerType, "threadReply");
    assert.equal(preAnalysis.mock.callCount(), 1);
  });

  it("skips thread reply without pre-analysis when autoResponseActive=false", async () => {
    const preAnalysis = mock.fn(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: false }),
      preAnalysis,
    });

    const result = await call(deps);

    assert.equal(result, null);
    assert.equal(preAnalysis.mock.callCount(), 0);
  });

  it("disengages session when pre-analysis returns 'stop'", async () => {
    const setActive = mock.fn(async (_id: string, _active: boolean) => {});
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: true }),
      preAnalysis: async () => "stop",
      setActive,
    });

    const result = await call(deps, "let's grab lunch");

    assert.equal(result, null);
    assert.equal(setActive.mock.callCount(), 1);
    assert.equal(setActive.mock.calls[0].arguments[0], "sess-1");
    assert.equal(setActive.mock.calls[0].arguments[1], false);
  });

  it("skips message (no disengage) when pre-analysis returns 'skip'", async () => {
    const setActive = mock.fn(async () => {});
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: true }),
      preAnalysis: async () => "skip",
      setActive,
    });

    const result = await call(deps, "thanks!");

    assert.equal(result, null);
    assert.equal(setActive.mock.callCount(), 0);
  });

  it("does not respond on 'skip' verdict", async () => {
    const setActive = mock.fn(async () => {});
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: true }),
      preAnalysis: async () => "skip",
      setActive,
    });

    const result = await call(deps, "thanks!");

    assert.equal(result, null);
    assert.equal(setActive.mock.callCount(), 0);
  });

  it("defaults autoResponseActive to true when field is absent (backward compat)", async () => {
    const preAnalysis = mock.fn(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: undefined }),
      preAnalysis,
    });

    const result = await call(deps);

    // Should proceed to pre-analysis (not skip as disengaged)
    assert.ok(result !== null);
    assert.equal(preAnalysis.mock.callCount(), 1);
  });

  it("runs pre-analysis for image-only thread reply using synthesized image metadata", async () => {
    const preAnalysis = mock.fn<typeof runPreAnalysis>(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: true }),
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
    assert.equal(preAnalysis.mock.callCount(), 1);
    // First arg is the resolved message text — should be the synthesized placeholder
    const messageArg = preAnalysis.mock.calls[0].arguments[0];
    assert.ok(messageArg.includes("[attached images:"));
    assert.ok(messageArg.includes("screenshot.png"));
    assert.ok(messageArg.includes("F1"));
  });

  it("disengages on 'stop' verdict for image-only thread reply", async () => {
    const setActive = mock.fn(async (_id: string, _active: boolean) => {});
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: true }),
      preAnalysis: async () => "stop",
      setActive,
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
    assert.equal(setActive.mock.callCount(), 1);
    assert.equal(setActive.mock.calls[0].arguments[1], false);
  });

  it("skips thread reply with no text and no images (no pre-analysis call)", async () => {
    const preAnalysis = mock.fn(async () => "respond" as const);
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: true }),
      preAnalysis,
    });

    const result = await call(deps, "");

    assert.equal(result, null);
    assert.equal(preAnalysis.mock.callCount(), 0);
  });
});

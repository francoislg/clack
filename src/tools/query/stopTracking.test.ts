import { describe, it, vi } from "vitest";
import { parseToolResult } from "../testHelpers.js";
import assert from "node:assert/strict";
import type { SessionContext } from "../../sessions.js";
import { createStopTrackingTool, type StopTrackingDeps } from "./stopTracking.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestCtx {
  mode: "query";
  userId: string;
  role: string;
}

function makeCtx(overrides: Partial<TestCtx> = {}): TestCtx {
  return {
    mode: "query",
    userId: "U_OWNER",
    role: "member",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<StopTrackingDeps> = {}): StopTrackingDeps {
  return {
    findSession: vi.fn(async () => null) as StopTrackingDeps["findSession"],
    setActive: vi.fn(async () => {}) as StopTrackingDeps["setActive"],
    isAdmin: (role: string) => role === "admin" || role === "owner",
    ...overrides,
  };
}

function callTool(ctx: TestCtx, deps: StopTrackingDeps, args: { url: string }) {
  const toolDef = createStopTrackingTool(ctx as never, deps);
  return toolDef.handler(args, {});
}

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "sess-1",
    channelId: "C123",
    messageTs: "1234567890.123456",
    threadTs: "1234567890.123456",
    userId: "U_OWNER",
    trigger: {
      type: "mentions",
      userId: "U_OWNER",
      messageTs: "1234567890.123456",
      messageText: "test",
    },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    autoResponseActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stop_tracking tool", () => {
  it("disengages a tracked session by URL", async () => {
    const setActive = vi.fn(async () => {});
    const deps = makeDeps({
      findSession: async () => session(),
      setActive,
    });

    const result = await callTool(makeCtx(), deps, {
      url: "https://team.slack.com/archives/C123/p1234567890123456",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.channel, "C123");
    assert.equal(parsed.session_id, "sess-1");
    assert.equal(setActive.mock.calls.length, 1);
  });

  it("returns error for invalid URL format", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps, { url: "not-a-slack-url" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("Invalid"));
    assert.equal(result.isError, true);
  });

  it("returns error when no session found", async () => {
    const deps = makeDeps({ findSession: async () => null });
    const result = await callTool(makeCtx(), deps, {
      url: "https://team.slack.com/archives/C123/p1234567890123456",
    });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("No tracked session"));
    assert.equal(result.isError, true);
  });

  it("rejects non-owner non-admin users", async () => {
    const setActive = vi.fn(async () => {});
    const deps = makeDeps({
      findSession: async () => session({ userId: "U_OTHER" }),
      setActive,
    });

    const result = await callTool(makeCtx({ userId: "U_REQUESTER", role: "member" }), deps, {
      url: "https://team.slack.com/archives/C123/p1234567890123456",
    });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("only stop tracking threads you started"));
    assert.equal(result.isError, true);
    assert.equal(setActive.mock.calls.length, 0);
  });

  it("allows admin to stop any thread", async () => {
    const setActive = vi.fn(async () => {});
    const deps = makeDeps({
      findSession: async () => session({ userId: "U_OTHER" }),
      setActive,
    });

    const result = await callTool(makeCtx({ userId: "U_ADMIN", role: "admin" }), deps, {
      url: "https://team.slack.com/archives/C123/p1234567890123456",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(setActive.mock.calls.length, 1);
  });

  it("returns success for already disengaged thread (idempotent)", async () => {
    const setActive = vi.fn(async () => {});
    const deps = makeDeps({
      findSession: async () => session({ autoResponseActive: false }),
      setActive,
    });

    const result = await callTool(makeCtx(), deps, {
      url: "https://team.slack.com/archives/C123/p1234567890123456",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.already_disengaged, true);
    assert.equal(setActive.mock.calls.length, 0);
  });

  it("uses threadTs from URL query param when present", async () => {
    const findSession = vi.fn(async (_ch: string, _ts: string) => session());
    const deps = makeDeps({
      findSession,
      setActive: async () => {},
    });

    await callTool(makeCtx(), deps, {
      url: "https://team.slack.com/archives/C123/p1234567890123456?thread_ts=9999999999.000000",
    });

    assert.equal(findSession.mock.calls[0][1], "9999999999.000000");
  });
});

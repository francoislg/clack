import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchSessionTranscript, type FindSessionTranscriptDeps } from "./findSessionTranscript.js";
import type { QueryToolContext } from "../types.js";
import type { SessionAssistantMessage, SessionTrigger } from "../../sessions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// On-disk session files span multiple shapes: pre-trigger-split with `messages[]` starting
// on a `source: "initial"` user turn; first-wave unified-log with the same; post-trigger-split
// with a discriminated `trigger` and `messages[]` starting on an assistant turn. This fixture
// intentionally allows legacy user source values alongside the new ones so all shapes compile.
type LegacyOrNewUserSource = "initial" | "refinement" | "reply" | "choice" | "followup";
interface FixtureUserMessage {
  role: "user";
  source: LegacyOrNewUserSource;
  text: string;
  ts: number;
  value?: string;
}
type FixtureMessage = FixtureUserMessage | SessionAssistantMessage;

interface SessionFileFields {
  sessionId?: string;
  channelId?: string;
  channelName?: string;
  triggerType?: string;
  userId?: string;
  displayName?: string;
  createdAt?: number;
  lastActivity?: number;
  messages?: FixtureMessage[];
  trigger?: SessionTrigger;
  // Legacy fields for synthesis coverage
  originalQuestion?: string;
  refinements?: string[];
  lastAnswer?: string;
}

function makeSessionFile(overrides: SessionFileFields = {}): string {
  const base: SessionFileFields = {
    sessionId: "sess-1",
    channelId: "C001",
    channelName: "general",
    triggerType: "mentions",
    userId: "U001",
    displayName: "Alice",
    createdAt: 1000,
    lastActivity: 2000,
    messages: [
      { role: "user", source: "initial", text: "Q1", ts: 1000 },
      { role: "assistant", ts: 1100, text: "A1" },
      { role: "user", source: "refinement", text: "Q2", ts: 1200 },
      { role: "assistant", ts: 1300, text: "A2" },
    ],
  };
  const merged = { ...base, ...overrides };
  const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
  return JSON.stringify(cleaned);
}

function makeCtx(userId = "U001"): QueryToolContext {
  return { userId } as QueryToolContext;
}

type SessionMap = Record<string, string | null>;
type PrivacyOverrides = Record<string, boolean>;

function makeDeps(
  sessions: SessionMap = {},
  privacy: PrivacyOverrides = {},
): FindSessionTranscriptDeps {
  const sessionsDir = "/fake/sessions";
  return {
    getSessionsDir: () => sessionsDir,
    fileExists: async (path: string) => {
      const match = path.match(/\/fake\/sessions\/([^/]+)\/context\.json$/);
      if (!match) return false;
      const id = match[1];
      return id !== undefined && id in sessions && sessions[id] !== null;
    },
    readFile: async (path: string) => {
      const match = path.match(/\/fake\/sessions\/([^/]+)\/context\.json$/);
      if (!match) throw new Error(`Unexpected readFile path: ${path}`);
      const id = match[1];
      const content = id !== undefined ? sessions[id] : undefined;
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },
    getChannelPrivacy: async (channelId: string) => privacy[channelId],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchSessionTranscript", () => {
  describe("owner read", () => {
    it("returns the full transcript to the session owner regardless of channel privacy", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ channelId: "Gprivate" }),
      });
      const result = await fetchSessionTranscript(
        makeCtx("U001"),
        { sessionId: "sess-1", offset: 0, limit: 20 },
        deps,
      );
      assert.ok(!("error" in result), "expected success for owner");
      if ("error" in result) return;
      assert.equal(result.sessionId, "sess-1");
      // Post-trigger-split: the legacy `source:"initial"` entry is lifted into the trigger,
      // leaving messages[] at [assistant, user-reply, assistant] = 3 entries.
      assert.equal(result.totalMessages, 3);
      assert.equal(result.messages.length, 3);
      assert.equal(result.trigger.type, "mentions");
    });
  });

  describe("non-owner privacy gate", () => {
    it("returns the transcript when the channel is confirmed public", async () => {
      const deps = makeDeps(
        { "sess-1": makeSessionFile({ channelId: "C001", userId: "U001" }) },
        { C001: false },
      );
      const result = await fetchSessionTranscript(
        makeCtx("U999"),
        { sessionId: "sess-1", offset: 0, limit: 20 },
        deps,
      );
      assert.ok(!("error" in result), "expected success for non-owner in public channel");
      if ("error" in result) return;
      assert.equal(result.totalMessages, 3);
    });

    it("rejects DMs (D-prefix) for non-owner", async () => {
      const deps = makeDeps({
        "sess-dm": makeSessionFile({ channelId: "Dabc", userId: "U001" }),
      });
      const result = await fetchSessionTranscript(
        makeCtx("U999"),
        { sessionId: "sess-dm", offset: 0, limit: 20 },
        deps,
      );
      assert.ok("error" in result, "expected error for non-owner DM");
      if (!("error" in result)) return;
      assert.equal(result.error, "session not visible");
    });

    it("rejects legacy private groups (G-prefix) for non-owner", async () => {
      const deps = makeDeps({
        "sess-g": makeSessionFile({ channelId: "Ggroup", userId: "U001" }),
      });
      const result = await fetchSessionTranscript(
        makeCtx("U999"),
        { sessionId: "sess-g", offset: 0, limit: 20 },
        deps,
      );
      assert.ok("error" in result, "expected error for non-owner G-channel");
      if (!("error" in result)) return;
      assert.equal(result.error, "session not visible");
    });

    it("rejects C-prefix channels confirmed private for non-owner", async () => {
      const deps = makeDeps(
        { "sess-c": makeSessionFile({ channelId: "Cpriv", userId: "U001" }) },
        { Cpriv: true },
      );
      const result = await fetchSessionTranscript(
        makeCtx("U999"),
        { sessionId: "sess-c", offset: 0, limit: 20 },
        deps,
      );
      assert.ok("error" in result, "expected error for non-owner private C-channel");
      if (!("error" in result)) return;
      assert.equal(result.error, "session not visible");
    });

    it("treats privacy-unknown channels as private (fail-closed)", async () => {
      const deps = makeDeps({
        "sess-c": makeSessionFile({ channelId: "Cunknown", userId: "U001" }),
      });
      // No privacy entry — dep returns undefined.
      const result = await fetchSessionTranscript(
        makeCtx("U999"),
        { sessionId: "sess-c", offset: 0, limit: 20 },
        deps,
      );
      assert.ok("error" in result, "expected error when privacy can't be determined");
      if (!("error" in result)) return;
      assert.equal(result.error, "session not visible");
    });
  });

  describe("pagination", () => {
    it("slices the transcript by offset and limit", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile(),
      });
      const result = await fetchSessionTranscript(
        makeCtx("U001"),
        { sessionId: "sess-1", offset: 1, limit: 2 },
        deps,
      );
      assert.ok(!("error" in result), "expected success");
      if ("error" in result) return;
      // Post-trigger-split totalMessages = 3 (initial lifted into trigger).
      assert.equal(result.totalMessages, 3);
      assert.equal(result.messages.length, 2);
      // messages[0] = user Q2 (ts 1200), messages[1] = assistant A2 (ts 1300)
      assert.equal(result.messages[0].ts, 1200);
      assert.equal(result.messages[1].ts, 1300);
    });

    it("returns empty messages when offset exceeds total but still reports totalMessages", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile(),
      });
      const result = await fetchSessionTranscript(
        makeCtx("U001"),
        { sessionId: "sess-1", offset: 100, limit: 20 },
        deps,
      );
      assert.ok(!("error" in result), "expected success");
      if ("error" in result) return;
      assert.equal(result.totalMessages, 3);
      assert.equal(result.messages.length, 0);
    });
  });

  describe("unknown session", () => {
    it("returns a structured error when the session does not exist", async () => {
      const deps = makeDeps({});
      const result = await fetchSessionTranscript(
        makeCtx("U001"),
        { sessionId: "missing", offset: 0, limit: 20 },
        deps,
      );
      assert.ok("error" in result, "expected error for missing session");
      if (!("error" in result)) return;
      assert.match(result.error, /not found/i);
    });

    it("does not throw on corrupt JSON — returns not-found error", async () => {
      const deps = makeDeps({
        "sess-bad": "{ this is not json",
      });
      const result = await fetchSessionTranscript(
        makeCtx("U001"),
        { sessionId: "sess-bad", offset: 0, limit: 20 },
        deps,
      );
      assert.ok("error" in result, "corrupt file should surface as not-found, not throw");
    });
  });

  describe("legacy synthesis", () => {
    it("synthesizes messages[] from legacy fields for pre-migration sessions", async () => {
      const deps = makeDeps({
        "sess-legacy": makeSessionFile({
          messages: undefined,
          originalQuestion: "Legacy question",
          refinements: ["follow up"],
          lastAnswer: "Legacy answer",
        }),
      });
      const result = await fetchSessionTranscript(
        makeCtx("U001"),
        { sessionId: "sess-legacy", offset: 0, limit: 20 },
        deps,
      );
      assert.ok(!("error" in result), "expected success");
      if ("error" in result) return;
      // Trigger now holds the originalQuestion; messages[] = [reply, assistant] = 2.
      if (result.trigger.type === "scheduled") {
        assert.fail("expected user-first trigger");
      }
      assert.equal(result.trigger.type, "mentions");
      assert.equal(result.trigger.messageText, "Legacy question");
      assert.equal(result.totalMessages, 2);
      assert.equal(result.messages[0].role, "user");
      if (result.messages[0].role === "user") {
        assert.equal(result.messages[0].source, "reply");
      }
      assert.equal(result.messages[1].role, "assistant");
      if (result.messages[1].role === "assistant") {
        assert.equal(result.messages[1].text, "Legacy answer");
      }
    });
  });

  describe("metadata", () => {
    it("includes sessionId, channelId, channelName, triggerType, userId, displayName, createdAt, lastActivity", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile(),
      });
      const result = await fetchSessionTranscript(
        makeCtx("U001"),
        { sessionId: "sess-1", offset: 0, limit: 20 },
        deps,
      );
      assert.ok(!("error" in result), "expected success");
      if ("error" in result) return;
      assert.equal(result.sessionId, "sess-1");
      assert.equal(result.channelId, "C001");
      assert.equal(result.channelName, "general");
      assert.equal(result.triggerType, "mentions");
      assert.equal(result.userId, "U001");
      assert.equal(result.displayName, "Alice");
      assert.equal(result.createdAt, 1000);
      assert.equal(result.lastActivity, 2000);
    });

    it("falls back lastActivity to createdAt when absent on disk", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ lastActivity: undefined }),
      });
      const result = await fetchSessionTranscript(
        makeCtx("U001"),
        { sessionId: "sess-1", offset: 0, limit: 20 },
        deps,
      );
      assert.ok(!("error" in result), "expected success");
      if ("error" in result) return;
      assert.equal(result.lastActivity, 1000);
    });
  });
});

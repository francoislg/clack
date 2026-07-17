import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { normalizePath } from "../../testUtils.js";
import {
  searchRecentInteractions,
  createFindRecentInteractionsTool,
  type FindRecentInteractionsDeps,
  type IncludeSection,
  type InteractionResult,
  type SearchArgs,
  type SearchResult,
} from "./findRecentInteractions.js";
import type { QueryToolContext } from "../types.js";
import { ZERO_USAGE, type SessionUsage } from "../../claude/usage.js";
import { parseToolResult } from "../testHelpers.js";

/** Full tool-handler args (the SDK passes a fully-parsed object — supply every schema key). */
function toolArgs(over: { include?: IncludeSection[] } = {}) {
  return {
    keywords: undefined,
    type: "all" as const,
    channel: undefined,
    trigger_type: undefined,
    include_auto_respond: false,
    limit: 10,
    offset: 0,
    since: undefined,
    since_hours: undefined,
    plugin: undefined,
    include: over.include ?? ["entries"],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SessionFileFields {
  sessionId?: string;
  channelId?: string;
  channelName?: string;
  triggerType?: string;
  userId?: string;
  displayName?: string;
  createdAt?: number;
  originalQuestion?: string;
  refinements?: string[];
  lastAnswer?: string;
  usage?: SessionUsage;
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
    originalQuestion: "What is the capital of France?",
    refinements: ["Paris right?"],
    lastAnswer: "Yes, Paris.",
  };
  const merged = { ...base, ...overrides };
  // Strip undefined values — JSON.stringify omits undefined, simulating absent fields
  const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
  return JSON.stringify(cleaned);
}

function makeCtx(userId = "U001"): QueryToolContext {
  return { userId } as QueryToolContext;
}

type SessionMap = Record<string, string | null>;

/** Privacy overrides keyed by channelId. Any channel not listed is treated as private (safe default). */
type PrivacyOverrides = Record<string, boolean>;

function makeDeps(
  sessions: SessionMap = {},
  privacy: PrivacyOverrides = {},
): FindRecentInteractionsDeps {
  const sessionsDir = "/fake/sessions";

  return {
    getSessionsDir: () => sessionsDir,
    fileExists: async (path: string) => {
      const p = normalizePath(path);
      if (p === sessionsDir) return true;
      const match = p.match(/\/fake\/sessions\/([^/]+)\/context\.json$/);
      if (!match) return false;
      const id = match[1];
      return id !== undefined && id in sessions && sessions[id] !== null;
    },
    readdir: async (path: string) => {
      if (normalizePath(path) !== sessionsDir) return [];
      return Object.keys(sessions);
    },
    readFile: async (path: string) => {
      const match = normalizePath(path).match(/\/fake\/sessions\/([^/]+)\/context\.json$/);
      if (!match) throw new Error(`Unexpected readFile path: ${path}`);
      const id = match[1];
      const content = id !== undefined ? sessions[id] : undefined;
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },
    statMtimeMs: async (path: string) => {
      // Fake mtime derived from session createdAt so sort-by-mtime matches sort-by-createdAt.
      const match = normalizePath(path).match(/\/fake\/sessions\/([^/]+)$/);
      if (!match) return 0;
      const id = match[1];
      const content = id !== undefined ? sessions[id] : undefined;
      if (!content) return 0;
      try {
        const parsed = JSON.parse(content) as { createdAt?: number };
        return parsed.createdAt ?? 0;
      } catch {
        return 0;
      }
    },
    getChannelPrivacy: async (channelId: string) => privacy[channelId],
  };
}

async function search(
  deps: FindRecentInteractionsDeps,
  ctx: QueryToolContext,
  args: SearchArgs = {},
): Promise<InteractionResult[]> {
  return (await searchRecentInteractions(ctx, args, deps)).entries ?? [];
}

/** Requests both sections so usage-aggregate tests can read `entries` and `totalUsage` together. */
async function searchFull(
  deps: FindRecentInteractionsDeps,
  ctx: QueryToolContext,
  args: SearchArgs = {},
): Promise<Required<SearchResult>> {
  const result = await searchRecentInteractions(
    ctx,
    { include: ["entries", "usage"], ...args },
    deps,
  );
  return { entries: result.entries ?? [], totalUsage: result.totalUsage ?? ZERO_USAGE };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("searchRecentInteractions", () => {
  describe("empty results", () => {
    it("returns empty array when sessions directory does not exist", async () => {
      const deps: FindRecentInteractionsDeps = {
        getSessionsDir: () => "/fake/sessions",
        fileExists: async () => false,
        readdir: async () => [],
        readFile: async () => {
          throw new Error("should not be called");
        },
        statMtimeMs: async () => 0,
        getChannelPrivacy: async () => undefined,
      };
      const results = await search(deps, makeCtx());
      assert.deepEqual(results, []);
    });

    it("returns empty array when no sessions exist", async () => {
      const results = await search(makeDeps({}), makeCtx());
      assert.deepEqual(results, []);
    });

    it("skips sessions with missing context.json", async () => {
      const deps = makeDeps({ "sess-1": null });
      const results = await search(deps, makeCtx());
      assert.deepEqual(results, []);
    });

    it("skips sessions with invalid JSON", async () => {
      const deps = makeDeps({ "sess-1": "not json" });
      const results = await search(deps, makeCtx());
      assert.deepEqual(results, []);
    });

    it("skips sessions missing required fields", async () => {
      const deps = makeDeps({
        "sess-1": JSON.stringify({ sessionId: "sess-1" }),
      });
      const results = await search(deps, makeCtx());
      assert.deepEqual(results, []);
    });
  });

  describe("privacy filter", () => {
    it("includes C-prefixed sessions for any caller when channel is known public", async () => {
      const deps = makeDeps(
        { "sess-1": makeSessionFile({ channelId: "C001", userId: "U999" }) },
        { C001: false },
      );
      const results = await search(deps, makeCtx("U001"));
      assert.equal(results.length, 1);
    });

    it("excludes C-prefixed sessions for non-owners when channel is private", async () => {
      const deps = makeDeps(
        { "sess-1": makeSessionFile({ channelId: "C001", userId: "U999" }) },
        { C001: true },
      );
      const results = await search(deps, makeCtx("U001"));
      assert.deepEqual(results, []);
    });

    it("excludes C-prefixed sessions for non-owners when privacy is unknown (safe default)", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ channelId: "C001", userId: "U999" }),
      });
      const results = await search(deps, makeCtx("U001"));
      assert.deepEqual(results, []);
    });

    it("includes C-prefixed session for the session owner regardless of privacy", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ channelId: "C001", userId: "U001" }),
      });
      const results = await search(deps, makeCtx("U001"));
      assert.equal(results.length, 1);
    });

    it("includes the caller's own DM sessions", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ channelId: "D001", userId: "U001" }),
      });
      const results = await search(deps, makeCtx("U001"));
      assert.equal(results.length, 1);
    });

    it("excludes another user's DM sessions", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ channelId: "D001", userId: "U999" }),
      });
      const results = await search(deps, makeCtx("U001"));
      assert.deepEqual(results, []);
    });

    it("excludes G-prefixed private channel sessions for non-owners", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ channelId: "G001", userId: "U999" }),
      });
      const results = await search(deps, makeCtx("U001"));
      assert.deepEqual(results, []);
    });

    it("includes G-prefixed channel session if caller is the session owner", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ channelId: "G001", userId: "U001" }),
      });
      const results = await search(deps, makeCtx("U001"));
      assert.equal(results.length, 1);
    });
  });

  describe("type filter", () => {
    const sessions: SessionMap = {
      "public-1": makeSessionFile({
        sessionId: "public-1",
        channelId: "C001",
        userId: "U999",
      }),
      "dm-1": makeSessionFile({
        sessionId: "dm-1",
        channelId: "D001",
        userId: "U001",
      }),
    };
    const publicPrivacy: PrivacyOverrides = { C001: false };

    it('type "all" returns both public and caller DM sessions', async () => {
      const results = await search(makeDeps(sessions, publicPrivacy), makeCtx("U001"), {
        type: "all",
      });
      assert.equal(results.length, 2);
    });

    it('type "public_channels" returns only public channel sessions', async () => {
      const results = await search(makeDeps(sessions, publicPrivacy), makeCtx("U001"), {
        type: "public_channels",
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].sessionId, "public-1");
    });

    it('type "public_channels" excludes C-prefixed channels that are private', async () => {
      const results = await search(makeDeps(sessions, { C001: true }), makeCtx("U001"), {
        type: "public_channels",
      });
      assert.equal(results.length, 0);
    });

    it('type "dm" returns only the caller\'s own DM sessions', async () => {
      const results = await search(makeDeps(sessions, publicPrivacy), makeCtx("U001"), {
        type: "dm",
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].sessionId, "dm-1");
    });

    it("type dm does not return another user's DM sessions", async () => {
      const otherUserDm = makeSessionFile({
        sessionId: "dm-other",
        channelId: "D002",
        userId: "U999",
      });
      const results = await search(
        makeDeps({ ...sessions, "dm-other": otherUserDm }, publicPrivacy),
        makeCtx("U001"),
        { type: "dm" },
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].sessionId, "dm-1");
    });
  });

  describe("keyword search", () => {
    it("matches on originalQuestion (case-insensitive)", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ originalQuestion: "What is TypeScript?" }),
        "sess-2": makeSessionFile({
          sessionId: "sess-2",
          originalQuestion: "Tell me about Python",
        }),
      });
      const results = await search(deps, makeCtx(), { keywords: "typescript" });
      assert.equal(results.length, 1);
      assert.equal(results[0].firstQuestion, "What is TypeScript?");
    });

    it("matches on refinements (case-insensitive)", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({
          refinements: ["Can you elaborate on interfaces?"],
        }),
        "sess-2": makeSessionFile({
          sessionId: "sess-2",
          refinements: ["What about classes?"],
        }),
      });
      const results = await search(deps, makeCtx(), { keywords: "interfaces" });
      assert.equal(results.length, 1);
    });

    it("matches on lastAnswer (case-insensitive)", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({
          lastAnswer: "The answer involves Fibonacci sequence.",
        }),
        "sess-2": makeSessionFile({
          sessionId: "sess-2",
          lastAnswer: "Binary search is O(log n).",
        }),
      });
      const results = await search(deps, makeCtx(), { keywords: "fibonacci" });
      assert.equal(results.length, 1);
    });

    it("returns no results when keyword does not match any session", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ originalQuestion: "Hello world" }),
      });
      const results = await search(deps, makeCtx(), { keywords: "notfound" });
      assert.deepEqual(results, []);
    });

    it("returns full session objects for matching sessions", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({
          originalQuestion: "keyword here",
          lastAnswer: "Full answer text.",
          refinements: ["follow up"],
        }),
      });
      const results = await search(deps, makeCtx(), { keywords: "keyword" });
      assert.equal(results.length, 1);
      assert.equal(results[0].latestAssistantText, "Full answer text.");
      // refinements are no longer in the summary — messageCount captures presence;
      // use find_session_transcript for the full transcript.
      assert.ok((results[0].messageCount ?? 0) >= 2);
    });
  });

  describe("scan limit", () => {
    it("caps scanned sessions to SCAN_LIMIT most-recent by mtime", async () => {
      // Create 600 sessions (> SCAN_LIMIT=500). The 100 oldest should be dropped.
      const sessions: SessionMap = {};
      for (let i = 0; i < 600; i++) {
        sessions[`sess-${i}`] = makeSessionFile({
          sessionId: `sess-${i}`,
          createdAt: i, // ascending createdAt → mtime
        });
      }
      const deps = makeDeps(sessions);
      const results = await search(deps, makeCtx(), { limit: 1000 });
      // Only the 500 most-recent by mtime/createdAt should be returned.
      assert.equal(results.length, 500);
      // Most-recent session is the last one created.
      assert.equal(results[0].sessionId, "sess-599");
      // Oldest returned session is at the cap boundary (600 - 500 = 100).
      assert.equal(results[results.length - 1].sessionId, "sess-100");
    });
  });

  describe("pagination", () => {
    const sessions: SessionMap = {
      "sess-1": makeSessionFile({ sessionId: "sess-1", createdAt: 1000 }),
      "sess-2": makeSessionFile({ sessionId: "sess-2", createdAt: 2000 }),
      "sess-3": makeSessionFile({ sessionId: "sess-3", createdAt: 3000 }),
      "sess-4": makeSessionFile({ sessionId: "sess-4", createdAt: 4000 }),
      "sess-5": makeSessionFile({ sessionId: "sess-5", createdAt: 5000 }),
    };

    it("returns sessions sorted by createdAt descending (most recent first)", async () => {
      const results = await search(makeDeps(sessions), makeCtx());
      const ids = results.map((r) => r.sessionId);
      assert.deepEqual(ids, ["sess-5", "sess-4", "sess-3", "sess-2", "sess-1"]);
    });

    it("respects limit", async () => {
      const results = await search(makeDeps(sessions), makeCtx(), { limit: 2 });
      assert.equal(results.length, 2);
      assert.equal(results[0].sessionId, "sess-5");
      assert.equal(results[1].sessionId, "sess-4");
    });

    it("respects offset", async () => {
      const results = await search(makeDeps(sessions), makeCtx(), {
        offset: 2,
        limit: 2,
      });
      assert.equal(results.length, 2);
      assert.equal(results[0].sessionId, "sess-3");
      assert.equal(results[1].sessionId, "sess-2");
    });

    it("offset beyond total returns empty array", async () => {
      const results = await search(makeDeps(sessions), makeCtx(), {
        offset: 10,
      });
      assert.deepEqual(results, []);
    });
  });

  describe("auto-respond filter", () => {
    const sessions: SessionMap = {
      "auto-1": makeSessionFile({
        sessionId: "auto-1",
        triggerType: "autoRespond",
        createdAt: 3000,
      }),
      "mention-1": makeSessionFile({
        sessionId: "mention-1",
        triggerType: "mentions",
        createdAt: 2000,
      }),
      "dm-1": makeSessionFile({
        sessionId: "dm-1",
        triggerType: "directMessages",
        channelId: "D001",
        userId: "U001",
        createdAt: 1000,
      }),
    };

    it("excludes autoRespond sessions by default", async () => {
      const results = await search(makeDeps(sessions), makeCtx("U001"));
      const ids = results.map((r) => r.sessionId);
      assert.ok(!ids.includes("auto-1"), "auto-respond session should be excluded");
      assert.equal(results.length, 2);
    });

    it("includes autoRespond sessions when includeAutoRespond is true", async () => {
      const results = await search(makeDeps(sessions), makeCtx("U001"), {
        includeAutoRespond: true,
      });
      assert.equal(results.length, 3);
      assert.ok(results.some((r) => r.sessionId === "auto-1"));
    });

    it("sessions with no triggerType are not excluded (treated as non-auto-respond)", async () => {
      const deps = makeDeps({
        "no-type": makeSessionFile({
          sessionId: "no-type",
          triggerType: undefined,
        }),
      });
      const results = await search(deps, makeCtx());
      assert.equal(results.length, 1);
    });
  });

  describe("result format", () => {
    it("maps session fields to result format correctly", async () => {
      const deps = makeDeps({
        "sess-abc": makeSessionFile({
          sessionId: "sess-abc",
          channelId: "C001",
          channelName: "dev-team",
          triggerType: "mentions",
          userId: "U001",
          displayName: "Bob",
          createdAt: 9999,
          originalQuestion: "How does X work?",
          refinements: ["More detail?"],
          lastAnswer: "X works like this.",
        }),
      });
      const results = await search(deps, makeCtx());
      assert.equal(results.length, 1);
      const r = results[0];
      assert.equal(r.sessionId, "sess-abc");
      assert.equal(r.channelName, "dev-team");
      assert.equal(r.triggerType, "mentions");
      assert.equal(r.userId, "U001");
      assert.equal(r.displayName, "Bob");
      assert.equal(r.createdAt, 9999);
      assert.equal(r.firstQuestion, "How does X work?");
      assert.equal(r.latestAssistantText, "X works like this.");
      // Post-trigger-split: initial question lives on trigger (not messages[]),
      // so messages[] = [refinement, assistant answer] = 2.
      assert.ok(r.messageCount >= 2);
    });

    it("handles sessions missing refinements (pre-migration legacy shape)", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ refinements: undefined }),
      });
      const results = await search(deps, makeCtx());
      assert.equal(results.length, 1);
      assert.ok(results[0].firstQuestion);
    });

    it("latestAssistantText is undefined when no assistant turn has occurred", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ lastAnswer: undefined }),
      });
      const results = await search(deps, makeCtx());
      assert.equal(results.length, 1);
      assert.equal(results[0].latestAssistantText, undefined);
    });
  });

  describe("channel filter", () => {
    it("returns only sessions whose channelId matches the channel arg", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ sessionId: "sess-1", channelId: "C001" }),
        "sess-2": makeSessionFile({ sessionId: "sess-2", channelId: "C002" }),
      });
      const results = await search(deps, makeCtx(), { channel: "C001" });
      assert.equal(results.length, 1);
      assert.equal(results[0].sessionId, "sess-1");
    });

    it("returns empty when no session matches the channel filter", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ channelId: "C001" }),
      });
      const results = await search(deps, makeCtx(), { channel: "C999" });
      assert.deepEqual(results, []);
    });
  });

  describe("trigger_type filter", () => {
    it("returns only sessions with matching triggerType", async () => {
      const deps = makeDeps({
        "sess-1": makeSessionFile({ sessionId: "sess-1", triggerType: "mentions" }),
        "sess-2": makeSessionFile({ sessionId: "sess-2", triggerType: "directMessages" }),
      });
      const results = await search(deps, makeCtx(), { triggerType: "directMessages" });
      assert.equal(results.length, 1);
      assert.equal(results[0].sessionId, "sess-2");
    });
  });

  describe("skippedTurnCount", () => {
    it("counts assistant messages flagged as skipped in the unified log", async () => {
      // Direct JSON — a session with a unified `messages` array containing a skipped turn.
      const persisted = JSON.stringify({
        sessionId: "sess-1",
        channelId: "C001",
        userId: "U001",
        createdAt: 1000,
        lastActivity: 2000,
        originalQuestion: "hi",
        messages: [
          { role: "user", source: "initial", text: "hi", ts: 1000 },
          { role: "assistant", ts: 1500, text: "hello" },
          { role: "assistant", ts: 1800, skipped: true },
        ],
      });
      const deps = makeDeps({ "sess-1": persisted });
      const results = await search(deps, makeCtx());
      assert.equal(results.length, 1);
      assert.equal(results[0].skippedTurnCount, 1);
      assert.equal(results[0].assistantTurnCount, 2);
      assert.equal(results[0].messageCount, 3);
    });
  });

  describe("since filter", () => {
    it("excludes sessions created before `since`", async () => {
      const deps = makeDeps({
        old: makeSessionFile({ sessionId: "old", createdAt: 1000 }),
        new: makeSessionFile({ sessionId: "new", createdAt: 5000 }),
      });
      const results = await search(deps, makeCtx(), { since: 3000 });
      assert.equal(results.length, 1);
      assert.equal(results[0].sessionId, "new");
    });

    it("includes sessions created exactly at `since` (inclusive lower bound)", async () => {
      const deps = makeDeps({
        boundary: makeSessionFile({ sessionId: "boundary", createdAt: 3000 }),
      });
      const results = await search(deps, makeCtx(), { since: 3000 });
      assert.equal(results.length, 1);
      assert.equal(results[0].sessionId, "boundary");
    });

    it("no `since` is not bounded below by creation time", async () => {
      const deps = makeDeps({
        old: makeSessionFile({ sessionId: "old", createdAt: 1 }),
        new: makeSessionFile({ sessionId: "new", createdAt: 9000 }),
      });
      const results = await search(deps, makeCtx());
      assert.equal(results.length, 2);
    });
  });

  describe("sinceHours filter", () => {
    const NOW = 100 * 60 * 60 * 1000;

    it("computes the cutoff server-side from the current clock", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      try {
        const deps = makeDeps({
          recent: makeSessionFile({ sessionId: "recent", createdAt: NOW - 2 * 60 * 60 * 1000 }),
          stale: makeSessionFile({ sessionId: "stale", createdAt: NOW - 30 * 60 * 60 * 1000 }),
        });
        const results = await search(deps, makeCtx(), { sinceHours: 24 });
        assert.equal(results.length, 1);
        assert.equal(results[0].sessionId, "recent");
      } finally {
        vi.useRealTimers();
      }
    });

    it("`since` wins when both bounds are provided", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      try {
        const deps = makeDeps({
          old: makeSessionFile({ sessionId: "old", createdAt: 1000 }),
          new: makeSessionFile({ sessionId: "new", createdAt: 5000 }),
        });
        const results = await search(deps, makeCtx(), { since: 3000, sinceHours: 24 });
        assert.equal(results.length, 1);
        assert.equal(results[0].sessionId, "new");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("plugin filter", () => {
    const sessions = {
      "channelless-fire": makeSessionFile({
        sessionId: "channelless-fire",
        channelId: "channelless:job-1",
        userId: "plugin:idler",
        triggerType: "scheduled",
      }),
      "channeled-fire": makeSessionFile({
        sessionId: "channeled-fire",
        channelId: "C0REPORT",
        userId: "plugin:idler",
        triggerType: "scheduled",
      }),
      "other-plugin": makeSessionFile({
        sessionId: "other-plugin",
        channelId: "channelless:job-2",
        userId: "plugin:trivia",
        triggerType: "scheduled",
      }),
      "human-session": makeSessionFile({
        sessionId: "human-session",
        channelId: "C0REPORT",
        userId: "U001",
      }),
    };

    it("matches the plugin's system actor across channel'd and channelless fires", async () => {
      const deps = makeDeps(sessions);
      const results = await search(deps, makeCtx("plugin:idler"), { plugin: "idler" });
      const ids = results.map((r) => r.sessionId).sort();
      assert.deepEqual(ids, ["channeled-fire", "channelless-fire"]);
    });

    it("excludes everything for a plugin with no sessions", async () => {
      const deps = makeDeps(sessions);
      const results = await search(deps, makeCtx("plugin:idler"), { plugin: "gemini-image" });
      assert.equal(results.length, 0);
    });

    it("aggregates usage across both fire shapes when combined with include usage", async () => {
      const deps = makeDeps({
        "channelless-fire": makeSessionFile({
          sessionId: "channelless-fire",
          channelId: "channelless:job-1",
          userId: "plugin:idler",
          triggerType: "scheduled",
          usage: {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUsd: 0.5,
          },
        }),
        "channeled-fire": makeSessionFile({
          sessionId: "channeled-fire",
          channelId: "C0REPORT",
          userId: "plugin:idler",
          triggerType: "scheduled",
          usage: {
            inputTokens: 3,
            outputTokens: 4,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUsd: 0.25,
          },
        }),
      });
      const { totalUsage } = await searchFull(deps, makeCtx("plugin:idler"), { plugin: "idler" });
      assert.equal(totalUsage.costUsd, 0.75);
      assert.equal(totalUsage.inputTokens, 4);
    });
  });

  describe("usage aggregate via include", () => {
    const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
      ...over,
    });

    it("sums usage component-wise across the matched set", async () => {
      const deps = makeDeps({
        a: makeSessionFile({
          sessionId: "a",
          createdAt: 1000,
          usage: usage({ inputTokens: 10, outputTokens: 2, costUsd: 0.5 }),
        }),
        b: makeSessionFile({
          sessionId: "b",
          createdAt: 2000,
          usage: usage({ inputTokens: 5, cacheReadTokens: 100, costUsd: 0.25 }),
        }),
      });
      const { totalUsage } = await searchFull(deps, makeCtx());
      assert.equal(totalUsage.inputTokens, 15);
      assert.equal(totalUsage.outputTokens, 2);
      assert.equal(totalUsage.cacheReadTokens, 100);
      assert.equal(totalUsage.costUsd, 0.75);
    });

    it("treats sessions without a usage field as zero", async () => {
      const deps = makeDeps({
        a: makeSessionFile({ sessionId: "a", createdAt: 1000, usage: usage({ inputTokens: 7 }) }),
        b: makeSessionFile({ sessionId: "b", createdAt: 2000 }),
      });
      const { totalUsage } = await searchFull(deps, makeCtx());
      assert.equal(totalUsage.inputTokens, 7);
      assert.equal(totalUsage.outputTokens, 0);
    });

    it("aggregates over the full matched set, independent of limit/offset", async () => {
      const deps = makeDeps({
        a: makeSessionFile({ sessionId: "a", createdAt: 1000, usage: usage({ inputTokens: 10 }) }),
        b: makeSessionFile({ sessionId: "b", createdAt: 2000, usage: usage({ inputTokens: 20 }) }),
        c: makeSessionFile({ sessionId: "c", createdAt: 3000, usage: usage({ inputTokens: 30 }) }),
      });
      const { entries, totalUsage } = await searchFull(deps, makeCtx(), { limit: 1 });
      assert.equal(entries.length, 1);
      assert.equal(totalUsage.inputTokens, 60);
    });

    it("returns a zero aggregate when no sessions match", async () => {
      const deps = makeDeps({
        a: makeSessionFile({ sessionId: "a", createdAt: 1000, usage: usage({ inputTokens: 9 }) }),
      });
      const { entries, totalUsage } = await searchFull(deps, makeCtx(), { since: 99999 });
      assert.equal(entries.length, 0);
      assert.deepEqual(totalUsage, usage());
    });

    it("respects since when aggregating (in-window total only)", async () => {
      const deps = makeDeps({
        old: makeSessionFile({
          sessionId: "old",
          createdAt: 1000,
          usage: usage({ inputTokens: 1000 }),
        }),
        recent: makeSessionFile({
          sessionId: "recent",
          createdAt: 5000,
          usage: usage({ inputTokens: 7 }),
        }),
      });
      const { totalUsage } = await searchFull(deps, makeCtx(), { since: 3000 });
      assert.equal(totalUsage.inputTokens, 7);
    });
  });
});

describe("find_recent_interactions tool — include projection result shape", () => {
  function toolWith(usageVal: SessionUsage) {
    const deps = makeDeps({
      a: makeSessionFile({ sessionId: "a", channelId: "C001", userId: "U001", usage: usageVal }),
    });
    return createFindRecentInteractionsTool(makeCtx("U001"), deps);
  }

  const usage: SessionUsage = {
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0.3,
  };

  it("returns an object with { entries } and no totalUsage by default", async () => {
    const toolDef = toolWith(usage);
    const parsed = parseToolResult(await toolDef.handler(toolArgs(), { sessionId: "t" }));
    assert.ok(!Array.isArray(parsed));
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.totalUsage, undefined);
  });

  it("returns { entries, totalUsage } when both sections are requested", async () => {
    const toolDef = toolWith(usage);
    const parsed = parseToolResult(
      await toolDef.handler(toolArgs({ include: ["entries", "usage"] }), { sessionId: "t" }),
    );
    assert.equal(parsed.entries.length, 1);
    assert.deepEqual(parsed.totalUsage, usage);
  });

  it("returns ONLY { totalUsage } and builds no entries for a usage-only request", async () => {
    const toolDef = toolWith(usage);
    const parsed = parseToolResult(
      await toolDef.handler(toolArgs({ include: ["usage"] }), { sessionId: "t" }),
    );
    assert.deepEqual(parsed.totalUsage, usage);
    // The bounded-payload guarantee: no entries are built or returned on the usage-only path.
    assert.deepEqual(Object.keys(parsed), ["totalUsage"]);
  });

  it("treats an empty include array as the entries-only default", async () => {
    const toolDef = toolWith(usage);
    const parsed = parseToolResult(
      await toolDef.handler(toolArgs({ include: [] }), { sessionId: "t" }),
    );
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.totalUsage, undefined);
  });
});

import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { computeConversationStats, type ConversationStatsDeps } from "./scan.js";

interface FakeSession {
  id: string;
  body: object | string;
}

function makeDeps(sessions: FakeSession[], over: Partial<ConversationStatsDeps> = {}) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const readFile = vi.fn(async (path: string) => {
    const id = path.split("/").at(-2);
    const session = id ? byId.get(id) : undefined;
    if (!session) throw new Error("ENOENT");
    return typeof session.body === "string" ? session.body : JSON.stringify(session.body);
  });
  const deps: ConversationStatsDeps = {
    readdir: vi.fn(async () => sessions.map((s) => s.id)),
    readFile,
    fileExists: vi.fn(async () => true),
    getSessionsDir: () => "/sessions",
    now: () => 2_000_000_000_000,
    ...over,
  };
  return { deps, readFile };
}

function struct(id: string, createdAt: number, over: object = {}) {
  const [channelId, , , userId] = id.split("-");
  return {
    id,
    body: {
      sessionId: id,
      channelId,
      userId,
      createdAt,
      trigger: { type: "mentions", messageText: "hi" },
      messages: [{ role: "assistant", ts: 0, text: "yo" }],
      ...over,
    },
  };
}

describe("computeConversationStats scan", () => {
  it("returns a well-formed empty bundle when the sessions dir is missing", async () => {
    const { deps } = makeDeps([], { fileExists: vi.fn(async () => false) });
    const bundle = await computeConversationStats({ from: null, to: null }, deps);
    assert.equal(bundle.totals.sessions, 0);
    assert.deepEqual(bundle.core.topAskers, []);
    assert.equal(bundle.core.longest.byTurns, null);
  });

  it("skips unparseable session files without aborting the scan", async () => {
    const { deps } = makeDeps([
      struct("C1-1-1-U1-1000", 1000),
      { id: "C2-1-1-U2-2000", body: "{ not json" },
      struct("C3-1-1-U3-3000", 3000),
    ]);
    const bundle = await computeConversationStats({ from: null, to: null }, deps);
    assert.equal(bundle.totals.sessions, 2);
  });

  it("excludes out-of-window sessions and never reads their bodies", async () => {
    const { deps, readFile } = makeDeps([
      struct("C1-1-1-U1-1000", 1000),
      struct("C2-1-1-U2-5000", 5000),
      struct("C3-1-1-U3-9000", 9000),
    ]);
    const bundle = await computeConversationStats({ from: 4000, to: 8000 }, deps);

    assert.equal(bundle.totals.sessions, 1);
    const readIds = readFile.mock.calls.map((c) => (c[0] as string).split("/").at(-2));
    assert.deepEqual(readIds, ["C2-1-1-U2-5000"]);
  });

  it("applies a half-open window: from is inclusive, to is exclusive", async () => {
    const { deps } = makeDeps([struct("C1-1-1-U1-4000", 4000), struct("C2-1-1-U2-8000", 8000)]);
    const bundle = await computeConversationStats({ from: 4000, to: 8000 }, deps);
    assert.equal(bundle.totals.sessions, 1);
    assert.equal(bundle.core.topAskers[0]?.userId, "U1");
  });

  it("reports the effective window and scanned count", async () => {
    const { deps } = makeDeps([struct("C1-1-1-U1-5000", 5000)]);
    const bundle = await computeConversationStats({ from: 1000, to: 9000 }, deps);
    assert.deepEqual(bundle.range, { from: 1000, to: 9000, sessionsScanned: 1 });
  });

  it("reads out-of-window-named files whose id does not parse", async () => {
    const { deps, readFile } = makeDeps([{ id: "weird-id", body: "{ bad" }]);
    await computeConversationStats({ from: 4000, to: 8000 }, deps);
    assert.equal(readFile.mock.calls.length, 1);
  });

  it("emits a bundle whose values are all numbers, ids, names, or emoji — never message text", async () => {
    const secret = "SECRET_QUESTION_TEXT";
    const { deps } = makeDeps([
      struct("C1-1-1-U1-1000", 1000, {
        displayName: "Alice",
        channelName: "general",
        trigger: { type: "mentions", messageText: secret },
        messages: [
          { role: "user", source: "reply", text: secret, ts: 0 },
          { role: "assistant", ts: 0, text: `${secret} 🚀` },
        ],
      }),
    ]);
    const bundle = await computeConversationStats({ from: null, to: null }, deps);
    assert.ok(!JSON.stringify(bundle).includes(secret));
    // The emoji from the assistant text is still surfaced (token only, not the text).
    assert.deepEqual(
      bundle.emoji.clackTop.map((e) => e.emoji),
      ["🚀"],
    );
  });
});

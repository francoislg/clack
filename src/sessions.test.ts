import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseSessionId,
  hasErrors,
  createSession,
  updateSession,
  appendUserMessage,
  appendAssistantMessage,
  appendStagedIntents,
  getStagedIntent,
  getSession,
  getSessionPath,
  addSessionUsage,
} from "./sessions.js";
import type { SessionContext, SessionAssistantMessage } from "./sessions.js";
import type { SessionUsage } from "./claude/usage.js";
import type { StagedIntent } from "./tools/types.js";

describe("parseSessionId", () => {
  it("parses a valid session ID into channelId, messageTs, and userId", () => {
    const result = parseSessionId("C0A82GNR25V-1768338604-542809-U09FSR0REUQ-1768400009272");
    assert.deepEqual(result, {
      channelId: "C0A82GNR25V",
      messageTs: "1768338604.542809",
      userId: "U09FSR0REUQ",
    });
  });

  it("handles different channel ID prefixes (C and G)", () => {
    const cResult = parseSessionId("C12345-1000000-111111-U12345-9999999");
    assert.ok(cResult);
    assert.equal(cResult.channelId, "C12345");

    const gResult = parseSessionId("G12345-1000000-111111-U12345-9999999");
    assert.ok(gResult);
    assert.equal(gResult.channelId, "G12345");
  });

  it("reconstructs messageTs with dot separator from hyphenated parts", () => {
    const result = parseSessionId("CABC123-1234567890-123456-UABC123-1700000000000");
    assert.ok(result);
    assert.equal(result.messageTs, "1234567890.123456");
  });

  it("returns null for malformed session IDs", () => {
    assert.equal(parseSessionId(""), null);
    assert.equal(parseSessionId("not-a-session-id"), null);
    assert.equal(parseSessionId("missing-parts"), null);
  });

  it("returns null when channel ID prefix is not C or G", () => {
    assert.equal(parseSessionId("X12345-1000000-111111-U12345-9999999"), null);
  });

  it("returns null when user ID prefix is not U", () => {
    assert.equal(parseSessionId("C12345-1000000-111111-X12345-9999999"), null);
  });

  it("returns null when timestamp segment is missing", () => {
    assert.equal(parseSessionId("C12345-U12345-9999999"), null);
  });
});

describe("hasErrors", () => {
  const baseSession: SessionContext = {
    sessionId: "test-session",
    channelId: "C123",
    messageTs: "1234.5678",
    threadTs: "1234.5678",
    userId: "U123",
    trigger: {
      type: "mentions",
      userId: "U123",
      messageTs: "1234.5678",
      messageText: "test question",
    },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
  };

  it("returns false when errors array is empty", () => {
    assert.equal(hasErrors(baseSession), false);
  });

  it("returns true when there are errors", () => {
    const session = {
      ...baseSession,
      errors: [
        {
          timestamp: Date.now(),
          errorMessage: "something went wrong",
          conversationTrace: [],
        },
      ],
    };
    assert.equal(hasErrors(session), true);
  });

  it("returns true with multiple errors", () => {
    const session = {
      ...baseSession,
      errors: [
        {
          timestamp: Date.now(),
          errorMessage: "error 1",
          conversationTrace: [],
        },
        {
          timestamp: Date.now(),
          errorMessage: "error 2",
          conversationTrace: [],
        },
      ],
    };
    assert.equal(hasErrors(session), true);
  });
});

// ---------------------------------------------------------------------------
// Concurrent updateSession — regression tests for context.json corruption.
//
// Prior to the per-session async mutex + atomic writeFile, two overlapping
// updateSession calls on the same session could race at the filesystem level:
// the shorter write would truncate the file while the longer write was still
// flushing, leaving valid JSON followed by trailing garbage from the earlier
// payload. Lost updates were also possible — writer B reading stale state and
// clobbering writer A's changes.
// ---------------------------------------------------------------------------
describe("updateSession concurrency", () => {
  const tmpBase = resolve(tmpdir(), `sessions-test-${process.pid}`);
  const sessionsDir = join(tmpBase, "data", "sessions");
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(sessionsDir, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
  });

  it("serializes concurrent appendUserMessage calls without losing updates", async () => {
    const session = await createSession({
      channelId: "C111",
      messageTs: "1000.0001",
      threadTs: "1000.0001",
      userId: "UAAA",
      trigger: {
        type: "mentions",
        userId: "UAAA",
        messageTs: "1000.0001",
        messageText: "concurrent refinements",
      },
    });

    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendUserMessage(session.sessionId, {
          role: "user",
          source: "reply",
          text: `r${i}`,
          ts: Date.now(),
        }),
      ),
    );

    const final = await getSession(session.sessionId);
    assert.ok(final);
    // Trigger holds the triggering message; messages[] starts empty, gets N replies.
    assert.equal(final.messages.length, N, "all replies should be appended — no lost updates");
    const refinementTexts = new Set(final.messages.map((m) => (m.role === "user" ? m.text : "")));
    for (let i = 0; i < N; i++) {
      assert.ok(refinementTexts.has(`r${i}`), `refinement r${i} should be present`);
    }
  });

  it("never leaves context.json half-written under concurrent large updates", async () => {
    const session = await createSession({
      channelId: "C222",
      messageTs: "2000.0002",
      threadTs: "2000.0002",
      userId: "UBBB",
      trigger: {
        type: "mentions",
        userId: "UBBB",
        messageTs: "2000.0002",
        messageText: "concurrent large writes",
      },
    });

    const bigPayload = "x".repeat(8000);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        updateSession(session.sessionId, {
          additionalSystemPrompt: `${bigPayload}-${i}`,
        }),
      ),
    );

    const contextPath = join(getSessionPath(session.sessionId), "context.json");
    const raw = readFileSync(contextPath, "utf-8");
    // Must parse cleanly — no trailing garbage from racing writers
    const parsed = JSON.parse(raw) as { additionalSystemPrompt?: string };
    assert.ok(parsed.additionalSystemPrompt?.startsWith(bigPayload));
  });

  it("quarantines a corrupt context.json on read so callers stop re-logging it", async () => {
    // Create a fresh session dir manually (bypassing createSession) so the
    // in-memory cache never sees it — otherwise getSession would hit the
    // cache and never touch disk.
    const freshId = "C444-4000-0004-UDDD-4444444444444";
    const freshDir = join(sessionsDir, freshId);
    mkdirSync(freshDir, { recursive: true });
    const validJson = JSON.stringify({
      sessionId: freshId,
      channelId: "C444",
      messageTs: "4000.0004",
      threadTs: "4000.0004",
      userId: "UDDD",
      originalQuestion: "corruption quarantine",
    });
    // Simulate a partial write: valid JSON followed by stale trailing bytes
    // (exactly the shape of the bug report).
    writeFileSync(join(freshDir, "context.json"), validJson + "undefined garbage", "utf-8");

    const result = await getSession(freshId);
    assert.equal(result, null, "corrupt session should return null");

    const files = readdirSync(freshDir);
    assert.equal(
      files.some((f) => f.startsWith("context.json.corrupt-")),
      true,
      "corrupt file should be quarantined with a .corrupt-{ts} suffix",
    );
    assert.equal(
      files.includes("context.json"),
      false,
      "original context.json should be moved aside",
    );

    // Second read should silently return null with no additional rename.
    const second = await getSession(freshId);
    assert.equal(second, null);
  });
});

// ---------------------------------------------------------------------------
// loadedSkills round-trip (lazy skill loading)
// ---------------------------------------------------------------------------

describe("loadedSkills persistence", () => {
  const tmpBase = resolve(tmpdir(), `sessions-loadedskills-${process.pid}`);
  const sessionsDir = join(tmpBase, "data", "sessions");
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("round-trips loadedSkills across updateSession + getSession", async () => {
    const session = await createSession({
      channelId: "CLOAD",
      messageTs: "5000.0001",
      threadTs: "5000.0001",
      userId: "ULOAD",
      trigger: {
        type: "mentions",
        userId: "ULOAD",
        messageTs: "5000.0001",
        messageText: "load skill round-trip",
      },
    });

    await updateSession(session.sessionId, {
      loadedSkills: [{ pack: "marketingskills", skill: "ab-test-setup" }],
    });

    // Verify via getSession (cache-hit path).
    const reloaded = await getSession(session.sessionId);
    assert.ok(reloaded);
    assert.deepEqual(reloaded.loadedSkills, [{ pack: "marketingskills", skill: "ab-test-setup" }]);

    // Verify the field lands on disk (cold read — bypass cache by reading file directly).
    const onDisk = readFileSync(join(getSessionPath(session.sessionId), "context.json"), "utf-8");
    // Cheap runtime check: the field's JSON shape appears verbatim in the file.
    assert.match(onDisk, /"loadedSkills"\s*:\s*\[\s*\{[^}]*"pack"\s*:\s*"marketingskills"/);
    assert.match(onDisk, /"skill"\s*:\s*"ab-test-setup"/);
  });
});

describe("action_token is never persisted", () => {
  const tmpBase = resolve(tmpdir(), `sessions-actiontoken-${process.pid}`);
  const sessionsDir = join(tmpBase, "data", "sessions");
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  // The action_token rides on the per-run tool context (AskClaudeOptions → QueryToolContext),
  // never on SessionContext — so it must be absent from the persisted record. This guards
  // against a future regression that adds the field to SessionContext and writes it to disk.
  it("omits action_token from the persisted session record", async () => {
    const session = await createSession({
      channelId: "DACTION",
      messageTs: "6000.0001",
      threadTs: "6000.0001",
      userId: "UACTION",
      trigger: {
        type: "directMessages",
        userId: "UACTION",
        messageTs: "6000.0001",
        messageText: "search for :bob:",
      },
    });

    assert.equal("actionToken" in session, false);
    assert.equal("action_token" in session, false);

    const onDisk = readFileSync(join(getSessionPath(session.sessionId), "context.json"), "utf-8");
    assert.doesNotMatch(onDisk, /action_token|actionToken/i);
  });
});

// ---------------------------------------------------------------------------
// Unified conversation log — appendUserMessage / appendAssistantMessage behavior.
// Exercises both the new `messages` array and the transitional dual-write to
// legacy `refinements` / `lastAnswer` / `lastResponse` / `toolCallHistory`.
// ---------------------------------------------------------------------------
describe("appendUserMessage / appendAssistantMessage", () => {
  const tmpBase = resolve(tmpdir(), `sessions-append-test-${process.pid}`);
  const sessionsDir = join(tmpBase, "data", "sessions");
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(sessionsDir, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
  });

  it("appendUserMessage appends a user message to the unified log", async () => {
    const session = await createSession({
      channelId: "C111",
      messageTs: "1000.0001",
      threadTs: "1000.0001",
      userId: "UAAA",
      trigger: {
        type: "mentions",
        userId: "UAAA",
        messageTs: "1000.0001",
        messageText: "original",
      },
    });

    const updated = await appendUserMessage(session.sessionId, {
      role: "user",
      source: "reply",
      text: "a follow up",
      ts: 1234,
    });
    assert.ok(updated);
    assert.equal(updated.messages.length, 1);
    const second = updated.messages[0];
    assert.equal(second.role, "user");
    if (second.role === "user") {
      assert.equal(second.source, "reply");
      assert.equal(second.text, "a follow up");
    }
  });

  it("appendUserMessage with source 'choice' preserves the value field", async () => {
    const session = await createSession({
      channelId: "C111",
      messageTs: "1000.0002",
      threadTs: "1000.0002",
      userId: "UAAA",
      trigger: {
        type: "mentions",
        userId: "UAAA",
        messageTs: "1000.0002",
        messageText: "original",
      },
    });

    const updated = await appendUserMessage(session.sessionId, {
      role: "user",
      source: "choice",
      text: "Go Left",
      value: "left",
      ts: 2000,
    });
    assert.ok(updated);
    const choice = updated.messages[0];
    assert.equal(choice.role, "user");
    if (choice.role === "user") {
      assert.equal(choice.source, "choice");
      assert.equal(choice.value, "left");
      assert.equal(choice.text, "Go Left");
    }
  });

  it("appendAssistantMessage appends an assistant turn with payload and toolCalls", async () => {
    const session = await createSession({
      channelId: "C222",
      messageTs: "2000.0001",
      threadTs: "2000.0001",
      userId: "UBBB",
      trigger: {
        type: "mentions",
        userId: "UBBB",
        messageTs: "2000.0001",
        messageText: "q",
      },
    });

    const assistantMsg: SessionAssistantMessage = {
      role: "assistant",
      ts: 5000,
      text: "here's the answer",
      payload: { message: "preamble", blocks: [], actions: [] },
      toolCalls: [{ tool: "list_repositories", args: {}, result: {}, timestamp: 4500 }],
    };
    const updated = await appendAssistantMessage(session.sessionId, assistantMsg);
    assert.ok(updated);
    assert.equal(updated.messages.length, 1);
    const turn = updated.messages[0];
    assert.equal(turn.role, "assistant");
    if (turn.role === "assistant") {
      assert.equal(turn.text, "here's the answer");
      assert.deepEqual(turn.payload, assistantMsg.payload);
      assert.equal(turn.toolCalls?.length, 1);
    }
  });

  it("appendAssistantMessage for a skipped turn stores only `skipped` without payload", async () => {
    const session = await createSession({
      channelId: "C333",
      messageTs: "3000.0001",
      threadTs: "3000.0001",
      userId: "UCCC",
      trigger: {
        type: "mentions",
        userId: "UCCC",
        messageTs: "3000.0001",
        messageText: "q",
      },
    });

    await appendAssistantMessage(session.sessionId, {
      role: "assistant",
      ts: 1000,
      text: "first",
      payload: { blocks: [], actions: [] },
    });

    const updated = await appendAssistantMessage(session.sessionId, {
      role: "assistant",
      ts: 2000,
      skipped: true,
    });
    assert.ok(updated);
    assert.equal(updated.messages.length, 2);
    const skippedTurn = updated.messages[1];
    assert.equal(skippedTurn.role, "assistant");
    if (skippedTurn.role === "assistant") {
      assert.equal(skippedTurn.skipped, true);
      assert.equal(skippedTurn.payload, undefined);
      assert.equal(skippedTurn.text, undefined);
    }
  });

  it("serializes concurrent appendUserMessage calls without losing updates", async () => {
    const session = await createSession({
      channelId: "C444",
      messageTs: "4000.0001",
      threadTs: "4000.0001",
      userId: "UDDD",
      trigger: {
        type: "mentions",
        userId: "UDDD",
        messageTs: "4000.0001",
        messageText: "concurrent appends",
      },
    });

    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendUserMessage(session.sessionId, {
          role: "user",
          source: "reply",
          text: `r${i}`,
          ts: 1000 + i,
        }),
      ),
    );

    const final = await getSession(session.sessionId);
    assert.ok(final);
    // N replies (trigger holds the triggering message)
    assert.equal(final.messages.length, N);
  });
});

// ---------------------------------------------------------------------------
// appendStagedIntents merge semantics — ensures a follow-up turn that stages
// a different intent does not invalidate refs still wired to buttons posted
// by an earlier turn.
// ---------------------------------------------------------------------------
describe("appendStagedIntents", () => {
  const tmpBase = resolve(tmpdir(), `sessions-intents-${process.pid}`);
  const sessionsDir = join(tmpBase, "data", "sessions");
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("merges new intents into existing stagedIntents instead of replacing", async () => {
    const session = await createSession({
      channelId: "C500",
      messageTs: "5000.0005",
      threadTs: "5000.0005",
      userId: "UEEE",
      trigger: {
        type: "mentions",
        userId: "UEEE",
        messageTs: "5000.0005",
        messageText: "merge test",
      },
    });

    const first: StagedIntent = {
      type: "change",
      branch: "feat/a",
      description: "a",
      repo: "r",
    };
    const second: StagedIntent = {
      type: "config_update",
      operation: "write",
      file: "user/identity.md",
      content: "b",
    };

    await appendStagedIntents(session.sessionId, { "ref-a": first });
    await appendStagedIntents(session.sessionId, { "ref-b": second });

    const a = await getStagedIntent(session.sessionId, "ref-a");
    const b = await getStagedIntent(session.sessionId, "ref-b");
    assert.deepEqual(a, first, "earlier turn's intent must survive a later append");
    assert.deepEqual(b, second);
  });

  it("is a no-op for an empty intent map", async () => {
    const session = await createSession({
      channelId: "C501",
      messageTs: "5001.0005",
      threadTs: "5001.0005",
      userId: "UFFF",
      trigger: {
        type: "mentions",
        userId: "UFFF",
        messageTs: "5001.0005",
        messageText: "empty test",
      },
    });

    await appendStagedIntents(session.sessionId, {});

    const stored = await getSession(session.sessionId);
    assert.ok(stored);
    assert.equal(stored.stagedIntents, undefined);
  });

  it("overwrites a same-key ref on later append (last writer wins)", async () => {
    const session = await createSession({
      channelId: "C502",
      messageTs: "5002.0005",
      threadTs: "5002.0005",
      userId: "UGGG",
      trigger: {
        type: "mentions",
        userId: "UGGG",
        messageTs: "5002.0005",
        messageText: "overwrite test",
      },
    });

    const v1: StagedIntent = {
      type: "change",
      branch: "feat/v1",
      description: "v1",
      repo: "r",
    };
    const v2: StagedIntent = {
      type: "change",
      branch: "feat/v2",
      description: "v2",
      repo: "r",
    };

    await appendStagedIntents(session.sessionId, { "ref-x": v1 });
    await appendStagedIntents(session.sessionId, { "ref-x": v2 });

    const got = await getStagedIntent(session.sessionId, "ref-x");
    assert.deepEqual(got, v2);
  });
});

// ---------------------------------------------------------------------------
// Token usage accumulation (addSessionUsage)
// ---------------------------------------------------------------------------

describe("addSessionUsage", () => {
  const tmpBase = resolve(tmpdir(), `sessions-usage-${process.pid}`);
  const sessionsDir = join(tmpBase, "data", "sessions");
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    ...over,
  });

  async function freshSession() {
    return createSession({
      channelId: "CUSE",
      messageTs: "6000.0001",
      threadTs: "6000.0001",
      userId: "UUSE",
      trigger: {
        type: "scheduled",
        prompt: "idler work",
      },
    });
  }

  it("initializes usage on a session that has none", async () => {
    const session = await freshSession();
    await addSessionUsage(session.sessionId, usage({ inputTokens: 10, costUsd: 0.5 }));

    const got = await getSession(session.sessionId);
    assert.deepEqual(got?.usage, usage({ inputTokens: 10, costUsd: 0.5 }));
  });

  it("accumulates every component independently across multiple folds", async () => {
    const session = await freshSession();
    // Each fold touches a different field so a per-field accumulation typo would surface.
    await addSessionUsage(session.sessionId, usage({ inputTokens: 10 }));
    await addSessionUsage(session.sessionId, usage({ outputTokens: 2 }));
    await addSessionUsage(session.sessionId, usage({ cacheReadTokens: 100 }));
    await addSessionUsage(session.sessionId, usage({ cacheCreationTokens: 7 }));
    await addSessionUsage(session.sessionId, usage({ costUsd: 1.5 }));
    // A final fold overlapping existing fields proves addition, not replacement.
    await addSessionUsage(session.sessionId, usage({ inputTokens: 5, costUsd: 0.5 }));

    const got = await getSession(session.sessionId);
    assert.deepEqual(
      got?.usage,
      usage({
        inputTokens: 15,
        outputTokens: 2,
        cacheReadTokens: 100,
        cacheCreationTokens: 7,
        costUsd: 2,
      }),
    );
  });

  it("survives across getSession reads (persisted, not just cached)", async () => {
    const session = await freshSession();
    await addSessionUsage(session.sessionId, usage({ inputTokens: 7 }));

    const contextPath = join(getSessionPath(session.sessionId), "context.json");
    const parsed = JSON.parse(readFileSync(contextPath, "utf-8")) as { usage?: SessionUsage };
    assert.equal(parsed.usage?.inputTokens, 7);
  });

  it("serializes concurrent folds without losing updates", async () => {
    const session = await freshSession();
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, () =>
        addSessionUsage(session.sessionId, usage({ inputTokens: 1 })),
      ),
    );

    const got = await getSession(session.sessionId);
    assert.equal(got?.usage?.inputTokens, N);
  });

  it("returns null for a missing session without throwing", async () => {
    const result = await addSessionUsage("C000-0-0-U000-0", usage({ inputTokens: 1 }));
    assert.equal(result, null);
  });
});

import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  registerThreadSession,
  findSessionByThread,
  createSession,
  getSession,
  isEngaged,
} from "./sessions.js";

describe("registerThreadSession", () => {
  const tmpBase = resolve(tmpdir(), `sessions-engagement-${process.pid}`);
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

  it("is a no-op for attentionLevel 'off' — nothing is seeded", async () => {
    const result = await registerThreadSession("C100", "1700000000.000100", {
      attentionLevel: "off",
      creationContext: "should not be stored",
    });
    assert.equal(result, null);
    assert.equal(await findSessionByThread("C100", "1700000000.000100"), null);
  });

  it("seeds a discoverable, engaged session for a non-off level", async () => {
    const seeded = await registerThreadSession("C101", "1700000000.000200", {
      attentionLevel: "high",
      creationContext: "Answer clarifications while pending.",
    });
    assert.ok(seeded);
    assert.equal(seeded.channelId, "C101");
    assert.equal(seeded.threadTs, "1700000000.000200");
    assert.equal(seeded.attentionLevel, "high");
    assert.equal(seeded.creationContext, "Answer clarifications while pending.");

    const found = await findSessionByThread("C101", "1700000000.000200");
    assert.ok(found);
    assert.equal(found.sessionId, seeded.sessionId);
    assert.ok(isEngaged(found));
  });

  it("stores no creationContext when it is omitted", async () => {
    const seeded = await registerThreadSession("C102", "1700000000.000300", {
      attentionLevel: "medium",
    });
    assert.ok(seeded);
    assert.equal(seeded.creationContext, undefined);
  });

  it("seeds deliveryMode onto the engaged session when supplied", async () => {
    const seeded = await registerThreadSession("C104", "1700000000.000500", {
      attentionLevel: "high",
      deliveryMode: "invisible",
    });
    assert.ok(seeded);
    assert.equal(seeded.deliveryMode, "invisible");

    const found = await findSessionByThread("C104", "1700000000.000500");
    assert.ok(found);
    assert.equal(found.deliveryMode, "invisible");
  });

  it("leaves deliveryMode unset when omitted (reads as streamer)", async () => {
    const seeded = await registerThreadSession("C105", "1700000000.000600", {
      attentionLevel: "high",
    });
    assert.ok(seeded);
    assert.equal(seeded.deliveryMode, undefined);
  });

  it("does not clobber an existing session for the same thread", async () => {
    const existing = await createSession({
      channelId: "C103",
      messageTs: "1700000000.000400",
      threadTs: "1700000000.000400",
      userId: "UREAL",
      trigger: {
        type: "mentions",
        userId: "UREAL",
        messageTs: "1700000000.000400",
        messageText: "a real conversation",
      },
      attentionLevel: "medium",
    });

    const result = await registerThreadSession("C103", "1700000000.000400", {
      attentionLevel: "always",
      creationContext: "should be ignored",
    });

    assert.ok(result);
    assert.equal(result.sessionId, existing.sessionId);
    // The real session's own state is preserved — no overwrite of level or prompt.
    const reread = await getSession(existing.sessionId);
    assert.ok(reread);
    assert.equal(reread.attentionLevel, "medium");
    assert.equal(reread.additionalSystemPrompt, undefined);
  });
});

import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  registerThreadSession,
  findSessionByThread,
  isEngaged,
  type SessionContext,
} from "../sessions.js";
import { buildPrompt } from "../claude/promptBuilder.js";

/**
 * End-to-end seam for plugin thread engagement: a non-off `attention_level` (as carried by a
 * `deliver_to` entry / `post_to` action / `sdk.engageThread`) seeds a destination-thread session
 * via the REAL `registerThreadSession`; a later human reply resolves it via the REAL
 * `findSessionByThread` and the REAL `buildPrompt` injects the seeded `followUpContext` into the
 * answer turn. Crosses the session store and the prompt builder with no mocking.
 */
describe("plugin thread engagement — seed → resolve → reply-turn prompt", () => {
  const tmpBase = resolve(tmpdir(), `engagement-integration-${process.pid}`);
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

  it("a high-attention delivery makes the destination thread engaged and carries followUpContext into the reply turn", async () => {
    const FOLLOW_UP = "Answer clarifications while the question is pending.";

    // The seeding the delivery adapter performs after a successful post.
    await registerThreadSession("C_DEST", "1700000000.000100", {
      attentionLevel: "high",
      followUpContext: FOLLOW_UP,
    });

    // A human reply in that thread resolves the seeded session.
    const seeded = await findSessionByThread("C_DEST", "1700000000.000100");
    assert.ok(seeded, "destination thread must resolve to a seeded session");
    assert.equal(seeded.attentionLevel, "high");
    assert.ok(isEngaged(seeded), "seeded session must be engaged");

    // The reply turn (triggerType threadReply) builds a prompt that injects the followUpContext.
    const replyTurnSession: SessionContext = { ...seeded, triggerType: "threadReply" };
    const prompt = buildPrompt(replyTurnSession);
    assert.ok(
      prompt.includes(FOLLOW_UP),
      "reply-turn prompt must inject the seeded followUpContext",
    );
  });

  it("an off / absent attention level seeds nothing (fire-and-forget preserved)", async () => {
    const off = await registerThreadSession("C_DEST2", "1700000000.000200", {
      attentionLevel: "off",
      followUpContext: "ignored",
    });
    assert.equal(off, null);
    assert.equal(await findSessionByThread("C_DEST2", "1700000000.000200"), null);
  });
});

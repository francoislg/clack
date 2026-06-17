import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { SessionMessage } from "../../../sessions.js";
import {
  createAccumulators,
  finalize,
  foldSession,
  normalizeSession,
  type FoldSession,
} from "./aggregate.js";

function userMsg(text: string): SessionMessage {
  return { role: "user", source: "reply", text, ts: 0 };
}

function asstMsg(over: { text?: string; skipped?: true; tools?: string[] } = {}): SessionMessage {
  return {
    role: "assistant",
    ts: 0,
    text: over.text,
    skipped: over.skipped,
    toolCalls: over.tools?.map((tool) => ({ tool, args: {}, result: {}, timestamp: 0 })),
  };
}

function session(over: Partial<FoldSession>): FoldSession {
  return {
    sessionId: "C1-1-1-U1-1000",
    channelId: "C1",
    userId: "U1",
    triggerType: "mentions",
    triggerText: "",
    createdAt: 1000,
    messages: [],
    ...over,
  };
}

function fold(sessions: FoldSession[], now = 2_000_000_000_000) {
  const acc = createAccumulators(now);
  for (const s of sessions) foldSession(acc, s);
  return finalize(acc);
}

describe("conversation-stats aggregate", () => {
  it("excludes scheduled and autoRespond from asker boards but counts their replies", () => {
    const bundle = fold([
      session({
        sessionId: "s1",
        userId: "U1",
        triggerType: "mentions",
        messages: [asstMsg({ text: "hi" })],
      }),
      session({
        sessionId: "s2",
        userId: "U2",
        triggerType: "scheduled",
        messages: [asstMsg({ text: "cron" })],
      }),
      session({
        sessionId: "s3",
        userId: "U3",
        triggerType: "autoRespond",
        messages: [asstMsg({ text: "auto" })],
      }),
    ]);

    assert.deepEqual(
      bundle.core.topAskers.map((a) => a.userId),
      ["U1"],
    );
    // All three assistant turns count as replies.
    assert.equal(bundle.totals.clackReplies, 3);
    assert.equal(bundle.totals.byTrigger.scheduled, 1);
    assert.equal(bundle.totals.byTrigger.autoRespond, 1);
  });

  it("reports longest conversation by turns and by duration independently", () => {
    const manyTurns = session({
      sessionId: "turns",
      messages: [userMsg("a"), asstMsg({ text: "1" }), userMsg("b"), asstMsg({ text: "2" })],
      createdAt: 1000,
      lastActivity: 1100,
    });
    const longDuration = session({
      sessionId: "duration",
      messages: [asstMsg({ text: "1" })],
      createdAt: 1000,
      lastActivity: 999_999,
    });
    const bundle = fold([manyTurns, longDuration]);

    assert.equal(bundle.core.longest.byTurns?.sessionId, "turns");
    assert.equal(bundle.core.longest.byDuration?.sessionId, "duration");
  });

  it("operationalizes personality counts from user text", () => {
    const bundle = fold([
      session({
        userId: "U1",
        triggerText: "what? really? please help!",
        messages: [userMsg("are you sure??")],
      }),
    ]);
    assert.equal(bundle.personality.mostInquisitive[0]?.count, 4); // 2 + 2
    assert.equal(bundle.personality.mostExcitable[0]?.count, 1);
    assert.equal(bundle.personality.politest[0]?.count, 1);
  });

  it("requires a minimum message count to qualify for the verbosity board", () => {
    const wordy = session({
      userId: "Uwordy",
      triggerText: "one two three four five",
      messages: [userMsg("six seven eight"), userMsg("nine ten")],
    });
    const oneShot = session({ userId: "Ushort", triggerText: "tiny", messages: [] });
    const bundle = fold([wordy, oneShot]);

    assert.deepEqual(
      bundle.personality.mostVerbose.map((v) => v.userId),
      ["Uwordy"],
    );
  });

  it("excludes scheduled cron prompts from word and verbosity stats", () => {
    const bundle = fold([
      session({
        userId: "U1",
        triggerType: "mentions",
        triggerText: "a b c",
        messages: [userMsg("d e f"), userMsg("g h i")],
      }),
      session({
        userId: "U2",
        triggerType: "scheduled",
        triggerText: "a very long cron prompt with many many words that would inflate verbosity",
        messages: [],
      }),
    ]);
    assert.deepEqual(
      bundle.personality.mostVerbose.map((v) => v.userId),
      ["U1"],
    );
  });

  it("does not inflate verbosity message counts with empty follow-ups", () => {
    const bundle = fold([
      session({
        userId: "U1",
        triggerText: "alpha beta gamma",
        messages: [userMsg("delta epsilon"), userMsg("zeta"), userMsg(""), userMsg("")],
      }),
    ]);
    // 3 non-empty texts (3 + 2 + 1 words) over 3 messages = avg 2.0; the empty msgs are ignored.
    assert.equal(bundle.personality.mostVerbose[0]?.avgWords, 2);
  });

  it("breaks leaderboard ties by identifier for a stable order", () => {
    const bundle = fold([
      session({ sessionId: "a", userId: "Ub", channelId: "Cb", triggerText: "hi" }),
      session({ sessionId: "b", userId: "Ua", channelId: "Ca", triggerText: "hi" }),
    ]);
    assert.deepEqual(
      bundle.core.topAskers.map((a) => a.userId),
      ["Ua", "Ub"],
    );
  });

  it("splits emoji between team (user text) and Clack (assistant text)", () => {
    const bundle = fold([
      session({
        triggerText: "ship it 🚀",
        messages: [asstMsg({ text: "done ✅" })],
      }),
    ]);
    assert.deepEqual(
      bundle.emoji.teamTop.map((e) => e.emoji),
      ["🚀"],
    );
    assert.deepEqual(
      bundle.emoji.clackTop.map((e) => e.emoji),
      ["✅"],
    );
  });

  it("counts skipped assistant turns as times-stayed-quiet, not replies", () => {
    const bundle = fold([
      session({ messages: [asstMsg({ text: "real" }), asstMsg({ skipped: true })] }),
    ]);
    assert.equal(bundle.totals.clackReplies, 1);
    assert.equal(bundle.engagement.timesStayedQuiet, 1);
  });

  it("tracks favourite tool and hardest-working session", () => {
    const bundle = fold([
      session({ sessionId: "light", messages: [asstMsg({ tools: ["git_log"] })] }),
      session({
        sessionId: "heavy",
        messages: [asstMsg({ tools: ["git_log", "git_log", "find_user"] })],
      }),
    ]);
    assert.equal(bundle.tools.favourite[0]?.tool, "git_log");
    assert.equal(bundle.tools.favourite[0]?.calls, 3);
    assert.equal(bundle.tools.hardestWorkingSession?.sessionId, "heavy");
    assert.equal(bundle.tools.hardestWorkingSession?.toolCalls, 3);
  });

  it("computes follow-up rate and marathoner over human sessions", () => {
    const bundle = fold([
      session({ userId: "U1", triggerText: "q", messages: [userMsg("follow up")] }),
      session({ userId: "U1", triggerText: "q", messages: [userMsg("again")] }),
      session({ userId: "U2", triggerText: "q", messages: [] }),
    ]);
    assert.equal(bundle.engagement.followUpRate, 2 / 3);
    assert.equal(bundle.engagement.marathoner?.userId, "U1");
    assert.equal(bundle.engagement.marathoner?.multiTurnSessions, 2);
  });

  it("excludes scheduled sessions from temporal histograms", () => {
    const at2am = new Date(2026, 0, 1, 2, 0, 0).getTime();
    const bundle = fold([
      session({ triggerType: "mentions", createdAt: at2am, messages: [asstMsg({ text: "x" })] }),
      session({
        triggerType: "scheduled",
        createdAt: at2am,
        messages: [asstMsg({ text: "cron" })],
      }),
    ]);
    assert.equal(bundle.temporal.afterMidnight, 1);
    assert.equal(bundle.temporal.byHour[2], 1);
  });

  it("counts DM askers only for DM-channel human sessions", () => {
    const bundle = fold([
      session({
        userId: "U1",
        channelId: "D123",
        triggerType: "directMessages",
        triggerText: "hi",
      }),
      session({ userId: "U2", channelId: "C123", triggerType: "mentions", triggerText: "hi" }),
    ]);
    assert.deepEqual(
      bundle.core.topDMAskers.map((a) => a.userId),
      ["U1"],
    );
  });
});

describe("conversation-stats normalizeSession", () => {
  it("normalizes a structured session", () => {
    const result = normalizeSession({
      sessionId: "s",
      channelId: "C1",
      userId: "U1",
      createdAt: 5,
      trigger: { type: "mentions", messageText: "hello" },
      messages: [],
    });
    assert.equal(result?.triggerType, "mentions");
    assert.equal(result?.triggerText, "hello");
  });

  it("normalizes a legacy session via originalQuestion", () => {
    const result = normalizeSession({
      sessionId: "s",
      channelId: "C1",
      userId: "U1",
      createdAt: 5,
      triggerType: "reactions",
      originalQuestion: "legacy q",
    });
    assert.equal(result?.triggerText, "legacy q");
    assert.deepEqual(result?.messages, []);
  });

  it("reads the scheduled prompt as trigger text", () => {
    const result = normalizeSession({
      sessionId: "s",
      channelId: "C1",
      userId: "U1",
      createdAt: 5,
      trigger: { type: "scheduled", prompt: "cron prompt" },
    });
    assert.equal(result?.triggerType, "scheduled");
    assert.equal(result?.triggerText, "cron prompt");
  });

  it("rejects sessions missing required fields", () => {
    assert.equal(normalizeSession({ channelId: "C1", userId: "U1", createdAt: 5 }), null);
    assert.equal(normalizeSession({ sessionId: "s", userId: "U1", createdAt: 5 }), null);
    assert.equal(normalizeSession({ sessionId: "s", channelId: "C1", userId: "U1" }), null);
  });
});

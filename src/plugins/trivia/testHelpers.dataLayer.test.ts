import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { createFakeSdk, primeTriviaConfig } from "./testHelpers.fakeSdk.js";
import { createTriviaDataLayer } from "./testHelpers.js";
import type { FakeSdk, FakeSdkTestHelpers } from "./testHelpers.fakeSdk.js";
import type { FakeTriviaDataLayer } from "./testHelpers.js";
import type { CheatReport, TeamAnswerSlot, TriviaDataLayer, TriviaQuestion } from "./core/types.js";

/**
 * Contract tests for `createTriviaDataLayer` — the real `createSdkDataLayer`
 * under spies. These assert the fake's own guarantees (spec `trivia-test-fakes`),
 * not any consumer's behavior.
 */

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "q1",
    category: "C",
    statement: "stmt",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    ...overrides,
  };
}

function makeCheat(overrides: Partial<CheatReport> = {}): CheatReport {
  return {
    cheaterUserId: "U1",
    questionId: "q1",
    reason: "posted the answer",
    detectedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("createTriviaDataLayer", () => {
  let sdk: FakeSdk;
  let testHelpers: FakeSdkTestHelpers;
  let dataLayer: FakeTriviaDataLayer;

  beforeEach(() => {
    ({ sdk, testHelpers } = createFakeSdk());
    primeTriviaConfig(sdk);
    ({ dataLayer } = createTriviaDataLayer(sdk));
  });

  it("is assignable to TriviaDataLayer with no cast", () => {
    const asReal: TriviaDataLayer = dataLayer;
    expect(asReal).toBe(dataLayer);
  });

  it("round-trips state through the real implementation", async () => {
    const q = makeQuestion();
    await dataLayer.forGame("main").saveQuestion(q);
    expect(await dataLayer.forGame("main").loadQuestions()).toEqual([q]);
  });

  it("shares one sdk store — writes are visible via testHelpers.files", async () => {
    await dataLayer.forGame("main").saveQuestion(makeQuestion());
    expect(testHelpers.files.has("games/main/questions.json")).toBe(true);
  });

  it("spies observe calls without altering behavior", async () => {
    const q = makeQuestion();
    const scoped = dataLayer.forGame("main");
    await scoped.saveQuestion(q);
    expect(scoped.saveQuestion).toHaveBeenCalledWith(q);
    expect(await scoped.loadQuestions()).toEqual([q]);
  });

  it("memoizes forGame by name so the production API is the observation point", async () => {
    // The "code under test" acquires its own accessor…
    const usedByCode = dataLayer.forGame("main");
    await usedByCode.saveQuestion(makeQuestion());
    // …and a later, separately obtained accessor is the SAME spy set.
    expect(dataLayer.forGame("main")).toBe(usedByCode);
    expect(dataLayer.forGame("main").saveQuestion).toHaveBeenCalledTimes(1);
    expect(dataLayer.forGame("other")).not.toBe(usedByCode);
  });

  it("stubs one method while the rest stay real", async () => {
    const scoped = dataLayer.forGame("main");
    const q = makeQuestion();
    scoped.loadQuestions.mockResolvedValue([q]);
    expect(await scoped.loadQuestions()).toEqual([q]);
    // A sibling write still runs the real implementation against the sdk store.
    await scoped.saveAnswer({ userId: "U1", questionId: "q1", answer: true, timestamp: 0 });
    expect(await scoped.loadAnswers()).toHaveLength(1);
  });

  it("programs a read independently of the corresponding write working", async () => {
    const scoped = dataLayer.forGame("main");
    const q = makeQuestion();
    scoped.loadQuestions.mockResolvedValue([q]);
    scoped.saveQuestion.mockRejectedValue(new Error("write path broken"));
    expect(await scoped.loadQuestions()).toEqual([q]);
  });

  it("supports read-after-write within one flow with no call-order stubbing", async () => {
    const scoped = dataLayer.forGame("main");
    await scoped.saveQuestion(makeQuestion({ id: "a" }));
    await scoped.updateQuestion("a", { postedAt: 5 });
    const [q] = await scoped.loadQuestions();
    expect(q.postedAt).toBe(5);
  });

  it("does not count internal cross-calls on sibling spies", async () => {
    const scoped = dataLayer.forGame("main");
    // saveQuestion re-reads the collection through its own closure — the spy
    // must see only the test's calls, never the implementation's internals.
    await scoped.saveQuestion(makeQuestion());
    expect(scoped.loadQuestions).not.toHaveBeenCalled();
  });

  it("runs the real season bootstrap when seasons are enabled", async () => {
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    const state = await dataLayer.forGame("main").loadSeasonsState();
    expect(state?.seasons).toHaveLength(1);
    expect(state?.seasons[0]?.slug).toMatch(/^season-\d{4}-\d{2}$/);
    expect(testHelpers.files.has("games/main/seasons.json")).toBe(true);
  });

  it("returns null seasons state when seasons are disabled", async () => {
    expect(await dataLayer.forGame("main").loadSeasonsState()).toBeNull();
  });

  it("computes cheat tallies with real logic — 1 then 2", async () => {
    const scoped = dataLayer.forGame("main");
    expect(await scoped.saveCheat(makeCheat())).toEqual({ totalAttempts: 1 });
    expect(await scoped.saveCheat(makeCheat({ questionId: "q2" }))).toEqual({
      totalAttempts: 2,
    });
  });

  it("records joins idempotently through the real users namespace", async () => {
    await dataLayer.recordJoin("U1");
    const accessor = sdk.users.data(z.object({ joinedAt: z.number().optional() }));
    const first = await accessor.get("U1");
    await dataLayer.recordJoin("U1");
    expect(await accessor.get("U1")).toEqual(first);
    expect(first?.joinedAt).toBeDefined();
  });
});

function makeSlot(overrides: Partial<TeamAnswerSlot> = {}): TeamAnswerSlot {
  return {
    teamName: "Red",
    questionId: "q1",
    answer: true,
    correct: true,
    lastAnsweredBy: "U1",
    timestamp: 100,
    ...overrides,
  };
}

describe("createTriviaDataLayer — team-answer store", () => {
  let sdk: FakeSdk;
  let dataLayer: FakeTriviaDataLayer;

  beforeEach(() => {
    ({ sdk } = createFakeSdk());
    primeTriviaConfig(sdk);
    ({ dataLayer } = createTriviaDataLayer(sdk));
  });

  it("returns [] when the store file is absent (graceful reader)", async () => {
    expect(await dataLayer.forGame("main").loadTeamAnswers()).toEqual([]);
  });

  it("upsert creates then overwrites the same (teamName, questionId) slot", async () => {
    const scoped = dataLayer.forGame("main");
    await scoped.upsertTeamAnswer(makeSlot({ lastAnsweredBy: "U1", answer: true }));
    await scoped.upsertTeamAnswer(makeSlot({ lastAnsweredBy: "U2", answer: false }));
    const slots = await scoped.loadTeamAnswers();
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ teamName: "Red", lastAnsweredBy: "U2", answer: false });
  });

  it("keeps distinct slots for different teams and questions", async () => {
    const scoped = dataLayer.forGame("main");
    await scoped.upsertTeamAnswer(makeSlot({ teamName: "Red", questionId: "q1" }));
    await scoped.upsertTeamAnswer(makeSlot({ teamName: "Blue", questionId: "q1" }));
    await scoped.upsertTeamAnswer(makeSlot({ teamName: "Red", questionId: "q2" }));
    expect(await scoped.loadTeamAnswers()).toHaveLength(3);
  });

  it("removeTeamAnswer drops only the matching slot", async () => {
    const scoped = dataLayer.forGame("main");
    await scoped.upsertTeamAnswer(makeSlot({ teamName: "Red", questionId: "q1" }));
    await scoped.upsertTeamAnswer(makeSlot({ teamName: "Blue", questionId: "q1" }));
    await scoped.removeTeamAnswer("Red", "q1");
    const slots = await scoped.loadTeamAnswers();
    expect(slots).toHaveLength(1);
    expect(slots[0].teamName).toBe("Blue");
  });

  it("removeTeamAnswer is a no-op write when nothing matches", async () => {
    const scoped = dataLayer.forGame("main");
    await scoped.removeTeamAnswer("Ghost", "q9");
    expect(await scoped.loadTeamAnswers()).toEqual([]);
  });
});

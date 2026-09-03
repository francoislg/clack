import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createPostQuestionsTool } from "./postQuestions.js";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import {
  createFakeSdk,
  createFakePostQuestionsSlackDeps,
  primeTriviaConfig,
} from "../../testHelpers.fakeSdk.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { FakeSdk } from "../../testHelpers.fakeSdk.js";
import type { PhaseSlice, TriviaQuestion } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 86_400_000;
const SAMPLE_BLOCKS = [{ type: "section" as const, text: { type: "mrkdwn" as const, text: "Q?" } }];

/**
 * Post-time axis resolution (`liveAnswersVisible`/`revealResponses`) reads the phase the
 * question was POSED under — its `save_question` stamp — not the clock at post time. With
 * `prepCron`, a question generated under one phase can be posted after the window rolls to
 * the next; honouring the stamp keeps a staged question internally coherent.
 */
describe("post_questions — phase stamp drives post-time axes", () => {
  let data: FakeTriviaDataLayer;
  let sdk: FakeSdk;
  beforeEach(async () => {
    const fake = createFakeSdk();
    sdk = fake.sdk;
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;
  });

  async function seedSeason(overrides: {
    startedAt: number;
    expectedEndAt: number;
    phases?: PhaseSlice[];
  }): Promise<void> {
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
      seasons: [{ slug: "s1", ...overrides }],
    });
  }

  async function postAndRead(
    overrides: Partial<TriviaQuestion> & { id: string },
  ): Promise<TriviaQuestion> {
    const defaults: TriviaQuestion = {
      id: overrides.id,
      category: "Trivia",
      statement: "is this true?",
      answersFormat: "boolean",
      questionType: "fact",
      isTrue: true,
      emojis: ["⚡"],
      createdAt: 100,
    };
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({ ...defaults, ...overrides });
    const tool = createPostQuestionsTool(
      data,
      sdk,
      fixtureGetGames,
      createFakePostQuestionsSlackDeps(),
    );
    const parsed = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          items: [{ questionId: overrides.id, blocks: SAMPLE_BLOCKS }],
          appendToPreviousBatch: undefined,
          suppress_unfurls: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(parsed.results[0].ok, true);
    const stored = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions()).find(
      (q) => q.id === overrides.id,
    );
    assert.ok(stored !== undefined, "posted question should be readable back");
    return stored;
  }

  it("resolves the two axes through the question's stamped phase (phase active at post)", async () => {
    const now = Date.now();
    // `early` runs its first day; `now` sits half a day in → `early` is active.
    await seedSeason({
      startedAt: now - DAY / 2,
      expectedEndAt: now + 20 * DAY,
      phases: [
        { slug: "early", days: 1, liveAnswersVisible: false, revealResponses: "no" },
        { slug: "late" },
      ],
    });

    const stored = await postAndRead({ id: "Q1", season: "s1", phase: "early" });
    assert.equal(stored.liveAnswersVisible, false);
    assert.equal(stored.revealResponses, "no");
  });

  it("uses the STAMPED phase A even when phase B is the one active at post time", async () => {
    const now = Date.now();
    // `early` = [now-2d, now-1d); `late` = [now-1d, end) → `late` is active now.
    // The question is stamped `early`, so its axes must come from `early`, not `late`.
    await seedSeason({
      startedAt: now - 2 * DAY,
      expectedEndAt: now + 20 * DAY,
      phases: [
        { slug: "early", days: 1, liveAnswersVisible: false, revealResponses: "no" },
        { slug: "late", liveAnswersVisible: true, revealResponses: "just-winners" },
      ],
    });

    const stored = await postAndRead({ id: "Q1", season: "s1", phase: "early" });
    // `early` values — NOT `late`'s (true / "just-winners") nor the defaults (true / "yes").
    assert.equal(stored.liveAnswersVisible, false);
    assert.equal(stored.revealResponses, "no");
  });

  it("a question with no phase stamp resolves to the cascade defaults", async () => {
    const now = Date.now();
    await seedSeason({ startedAt: now - DAY, expectedEndAt: now + 20 * DAY });

    const stored = await postAndRead({ id: "Q1", season: "s1" });
    assert.equal(stored.liveAnswersVisible, true);
    assert.equal(stored.revealResponses, "yes");
  });
});

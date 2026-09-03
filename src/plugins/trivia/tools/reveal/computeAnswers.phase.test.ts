import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createComputeAnswersTool } from "./computeAnswers.js";
import {
  createFakeSdk,
  createFakeRevealSlackDeps,
  primeTriviaConfig,
} from "../../testHelpers.fakeSdk.js";
import { createTriviaDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaQuestion } from "../../core/types.js";

/**
 * Reveal-time cascade resolution reads each question's STAMPED `season`/`phase`, not
 * the clock. These cover the two `buildCascadeContext` call sites in `compute_answers`
 * that source season/phase from the question's stamp (the reprocess re-stamp path and
 * the main-batch guidance resolution). Scoring concerns keep the reveal-time season and
 * are covered in `computeAnswers.test.ts`.
 */

const SESSION = { sessionId: "test" };
const DAY = 86_400_000;

function makeData() {
  const { sdk } = createFakeSdk();
  primeTriviaConfig(sdk);
  const { dataLayer } = createTriviaDataLayer(sdk);
  return { sdk, dataLayer };
}

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q",
    category: "C",
    statement: "stmt",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    postedAt: 1_000,
    messageLink: "https://x.slack.com/archives/C100000000/p1700000000000000",
    revealResponses: "yes",
    ...overrides,
  };
}

function makeTool(
  data: ReturnType<typeof makeData>["dataLayer"],
  sdk: ReturnType<typeof makeData>["sdk"],
) {
  // Empty workspace config so the guidance axes resolve only through the season/phase
  // tiers this suite seeds — the game fixture carries no instructions either.
  return createComputeAnswersTool(
    data,
    sdk,
    fixtureGetGames,
    createFakeRevealSlackDeps(),
    () => ({}),
  );
}

async function run(tool: ReturnType<typeof createComputeAnswersTool>) {
  return parseToolResult(
    await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined, reprocessBatchId: undefined },
      SESSION,
    ),
  );
}

describe("compute_answers — phase-stamped cascade resolution", () => {
  it("resolves instructions/additionalInstructions through the STAMPED phase, not the clock", async () => {
    const { sdk, dataLayer: data } = makeData();
    const now = Date.now();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveSeasonsState({
      seasons: [
        {
          slug: "s1",
          startedAt: now - 10 * DAY,
          expectedEndAt: now + 10 * DAY,
          phases: [
            { slug: "ramp", days: 1, instructions: "RAMP", additionalInstructions: "ramp-extra" },
            {
              slug: "gauntlet",
              instructions: "GAUNTLET",
              additionalInstructions: "gauntlet-extra",
            },
          ],
        },
      ],
    });
    // `now` is 10 days past startedAt → inside the open-ended `gauntlet` window, so a
    // clock-based selection would pick `gauntlet`. The question was posed under `ramp`.
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", season: "s1", phase: "ramp", postedAt: now - 9 * DAY }),
    );

    const res = await run(makeTool(data, sdk));
    assert.equal(res.reveals.length, 1);
    assert.equal(res.instructions, "RAMP");
    assert.equal(res.additionalInstructions, "[Phase] ramp-extra");
  });

  it("resolves the phase from the question's STAMPED season, not the season active at reveal time", async () => {
    const { sdk, dataLayer: data } = makeData();
    const now = Date.now();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveSeasonsState({
      seasons: [
        {
          slug: "autumn",
          startedAt: now - 30 * DAY,
          expectedEndAt: now - 5 * DAY,
          endedAt: now - 5 * DAY,
          phases: [{ slug: "ramp", instructions: "AUTUMN-RAMP" }],
        },
        {
          slug: "winter",
          startedAt: now - 4 * DAY,
          expectedEndAt: now + 20 * DAY,
          phases: [{ slug: "ramp", instructions: "WINTER-RAMP" }],
        },
      ],
    });
    // Revealed now (winter is active), but the question was posed in autumn. Its phase
    // must resolve from autumn's slices, not winter's same-named slice.
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", season: "autumn", phase: "ramp", postedAt: now - 25 * DAY }),
    );

    const res = await run(makeTool(data, sdk));
    assert.equal(res.reveals.length, 1);
    assert.equal(res.instructions, "AUTUMN-RAMP");
  });

  it("resolves with NO phase tier (no substitution, no error) when the stamped slug matches no slice", async () => {
    const { sdk, dataLayer: data } = makeData();
    const now = Date.now();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveSeasonsState({
      seasons: [
        {
          slug: "s1",
          startedAt: now - 5 * DAY,
          expectedEndAt: now + 20 * DAY,
          instructions: "SEASON-INSTR",
          phases: [{ slug: "ramp", instructions: "RAMP-INSTR" }],
        },
      ],
    });
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", season: "s1", phase: "ghost", postedAt: now - 4 * DAY }),
    );

    const res = await run(makeTool(data, sdk));
    // No error: the reveal still processes. No substitution: the phase tier is absent,
    // so instructions fall through to the SEASON tier rather than borrowing ramp's value.
    assert.equal(res.reveals.length, 1);
    assert.equal(res.instructions, "SEASON-INSTR");
  });

  it("anchors the batch's guidance on the first target's phase stamp", async () => {
    const { sdk, dataLayer: data } = makeData();
    const now = Date.now();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveSeasonsState({
      seasons: [
        {
          slug: "s1",
          startedAt: now - 5 * DAY,
          expectedEndAt: now + 20 * DAY,
          phases: [
            { slug: "ramp", days: 1, instructions: "RAMP" },
            { slug: "gauntlet", instructions: "GAUNTLET" },
          ],
        },
      ],
    });
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        batchId: "B",
        season: "s1",
        phase: "ramp",
        postedAt: now - 4 * DAY,
      }),
    );
    await scoped.saveQuestion(
      makeQuestion({
        id: "q2",
        batchId: "B",
        season: "s1",
        phase: "gauntlet",
        postedAt: now - 3 * DAY,
      }),
    );

    const res = await run(makeTool(data, sdk));
    assert.equal(res.reveals.length, 2);
    // Targets sort postedAt-ascending → q1 (ramp) is targets[0], the batch anchor.
    assert.equal(res.instructions, "RAMP");
  });

  it("falls back to the reveal-time season when the question carries no season stamp", async () => {
    const { sdk, dataLayer: data } = makeData();
    const now = Date.now();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveSeasonsState({
      seasons: [
        {
          slug: "winter",
          startedAt: now - 5 * DAY,
          expectedEndAt: now + 20 * DAY,
          instructions: "WINTER-SEASON",
        },
      ],
    });
    // Legacy row: no season, no phase stamp.
    await scoped.saveQuestion(makeQuestion({ id: "q1", postedAt: now - 4 * DAY }));

    const res = await run(makeTool(data, sdk));
    assert.equal(res.reveals.length, 1);
    assert.equal(res.instructions, "WINTER-SEASON");
  });

  it("reprocess re-stamps the axis from the question's OWN stamped season AND phase, not the season active at reveal", async () => {
    const { sdk, dataLayer: data } = makeData();
    const now = Date.now();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Two seasons, each with a same-named `ramp` phase but a different revealResponses.
    await scoped.saveSeasonsState({
      seasons: [
        {
          slug: "A",
          startedAt: now - 30 * DAY,
          expectedEndAt: now - 5 * DAY,
          endedAt: now - 5 * DAY,
          phases: [{ slug: "ramp", revealResponses: "no" }],
        },
        {
          slug: "B",
          startedAt: now - 4 * DAY,
          expectedEndAt: now + 20 * DAY,
          phases: [{ slug: "ramp", revealResponses: "just-winners" }],
        },
      ],
    });
    // Posed under A's `ramp`, already revealed; B (with a same-named `ramp`) is active now.
    // The seed carries a stale "yes" so a re-stamp is observable.
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        season: "A",
        phase: "ramp",
        postedAt: now - 25 * DAY,
        processedAt: now - 24 * DAY,
        revealResponses: "yes",
      }),
    );

    const res = parseToolResult(
      await makeTool(data, sdk).handler(
        { game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["q1"], reprocessBatchId: undefined },
        SESSION,
      ),
    );
    assert.equal(res.errors, undefined);
    assert.equal(res.reveals.length, 1);
    // Re-stamped from A's `ramp` ("no"), NOT B's same-named `ramp` ("just-winners").
    const [q] = await scoped.loadQuestions();
    assert.equal(q.revealResponses, "no");
  });

  it("reprocess degrades to no phase tier (no error) when the stamped phase slug is gone from the stamped season", async () => {
    const { sdk, dataLayer: data } = makeData();
    const now = Date.now();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveSeasonsState({
      seasons: [
        {
          slug: "A",
          startedAt: now - 30 * DAY,
          expectedEndAt: now - 5 * DAY,
          endedAt: now - 5 * DAY,
          revealResponses: "no", // season tier
          phases: [{ slug: "ramp", revealResponses: "just-correctness" }],
        },
        {
          slug: "B",
          startedAt: now - 4 * DAY,
          expectedEndAt: now + 20 * DAY,
        },
      ],
    });
    // Stamped phase `ghost` no longer exists on A → no phase tier; the axis falls through
    // to A's SEASON tier ("no"), never borrowing ramp's "just-correctness", and no error.
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        season: "A",
        phase: "ghost",
        postedAt: now - 25 * DAY,
        processedAt: now - 24 * DAY,
        revealResponses: "yes",
      }),
    );

    const res = parseToolResult(
      await makeTool(data, sdk).handler(
        { game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["q1"], reprocessBatchId: undefined },
        SESSION,
      ),
    );
    assert.equal(res.errors, undefined);
    assert.equal(res.reveals.length, 1);
    const [q] = await scoped.loadQuestions();
    assert.equal(q.revealResponses, "no");
  });
});

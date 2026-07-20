import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { KnownBlock, SectionBlock } from "@slack/types";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createOverrideQuestionTool } from "./overrideQuestion.js";
import { rewriteWorthBlock } from "./renderPoints.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaQuestion } from "../../core/types.js";

// The card renderer is a collaborator: this file asserts that override_question CALLS
// it correctly and persists what it returns. What the worth line actually renders as
// is renderPoints' own behavior, covered by renderPoints.test.ts.
vi.mock("./renderPoints.js", () => ({
  rewriteWorthBlock: vi.fn((): KnownBlock[] => REWRITTEN_BLOCKS),
}));

const REWRITTEN_BLOCKS: KnownBlock[] = [
  { type: "section", text: { type: "mrkdwn", text: "rewritten-by-renderPoints" } },
];

const SESSION = { sessionId: "test" };

type OverrideArgs = Parameters<ReturnType<typeof createOverrideQuestionTool>["handler"]>[0];

const POSTED_BLOCKS: KnownBlock[] = [
  { type: "section", text: { type: "mrkdwn", text: "The statement" } } satisfies SectionBlock,
];

async function seed(overrides: Partial<TriviaQuestion> = {}): Promise<TriviaQuestion> {
  const q: TriviaQuestion = {
    id: "Q1",
    category: "Science",
    statement: "Water boils at 100C",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["💧"],
    createdAt: 100,
    ...overrides,
  };
  await data.forGame(FIXTURE_GAME_NAME).saveQuestion(q);
  return q;
}

let sdk: ReturnType<typeof createFakeSdk>["sdk"];
let data: FakeTriviaDataLayer;

function makeTool() {
  return createOverrideQuestionTool(data, sdk, fixtureGetGames);
}

async function loadQ(id = "Q1"): Promise<TriviaQuestion> {
  const q = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions()).find((x) => x.id === id);
  assert.ok(q, `question ${id} missing`);
  return q;
}

function args(overrides: Partial<OverrideArgs> = {}): OverrideArgs {
  return {
    game: FIXTURE_GAME_NAME,
    questionId: "Q1",
    points: undefined,
    difficulty: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(rewriteWorthBlock).mockClear();
  const { sdk: newSdk } = createFakeSdk();
  sdk = newSdk;
  primeTriviaConfig(sdk);
  const { dataLayer } = createTriviaDataLayer(sdk);
  data = dataLayer;
});

describe("override_question — points", () => {
  it("re-points a revealed question without touching any answer row", async () => {
    await seed({ points: 3, processedAt: 5_000 });
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "Q1",
      answer: true,
      correct: true,
      timestamp: 1,
    });
    const before = await scoped.loadAnswers();

    const res = parseToolResult(await makeTool().handler(args({ points: 2 }), SESSION));
    assert.equal(res.action, "overridden");
    assert.equal(res.points, 2);
    assert.equal((await loadQ()).points, 2);
    assert.deepEqual(await scoped.loadAnswers(), before, "answer rows are untouched");
  });

  it("accepts a value above the game's configured cap — config never re-prices posed questions", async () => {
    // fixtureGetGames carries no points config, so the resolved generation cap is 1.
    await seed();
    const res = parseToolResult(await makeTool().handler(args({ points: 3 }), SESSION));
    assert.equal(res.points, 3);
    assert.equal((await loadQ()).points, 3);
  });

  it("normalizes a demotion to 1 into field absence", async () => {
    await seed({ points: 3 });
    const res = parseToolResult(await makeTool().handler(args({ points: 1 }), SESSION));
    assert.equal(res.points, 1);
    assert.equal((await loadQ()).points, undefined);
  });
});

describe("override_question — difficulty", () => {
  it("reclasses difficulty without touching suggestedDifficulty or the card", async () => {
    await seed({
      difficulty: 4,
      suggestedDifficulty: "Easy",
      postedBlocks: POSTED_BLOCKS,
    });
    const res = parseToolResult(await makeTool().handler(args({ difficulty: 8 }), SESSION));

    assert.equal(res.difficulty, 8);
    assert.equal(res.refreshHint, undefined, "a metadata-only change needs no repaint");
    expect(rewriteWorthBlock).not.toHaveBeenCalled();
    const q = await loadQ();
    assert.equal(q.difficulty, 8);
    assert.equal(q.suggestedDifficulty, "Easy", "the generation-time roll is not falsified");
    assert.deepEqual(q.postedBlocks, POSTED_BLOCKS, "the card is untouched");
  });
});

describe("override_question — originals", () => {
  it("captures the original once, so a second override cannot rewrite history", async () => {
    await seed({ points: 3 });
    const tool = makeTool();

    await tool.handler(args({ points: 2 }), SESSION);
    const second = parseToolResult(await tool.handler(args({ points: 4 }), SESSION));

    assert.equal(second.originals.points, 3, "still the generation-time value");
    const q = await loadQ();
    assert.equal(q.points, 4);
    assert.equal(q.overriddenFrom?.points, 3);
  });

  it("records an originally-unset points as 1, surviving a round-trip through storage", async () => {
    await seed(); // worth 1 (no points field)
    const tool = makeTool();

    await tool.handler(args({ points: 2 }), SESSION);
    assert.equal(
      (await loadQ()).overriddenFrom?.points,
      1,
      "absence is recorded as its semantic original, not as undefined (JSON drops those)",
    );

    // The re-read is the real test: an `undefined` original would have serialized
    // away, leaving this second override to capture 2 as the "original".
    const second = parseToolResult(await tool.handler(args({ points: 5 }), SESSION));
    assert.equal(second.originals.points, 1, "the true original survived the round-trip");
  });

  it("records an originally-unrated difficulty as null", async () => {
    await seed();
    const tool = makeTool();

    await tool.handler(args({ difficulty: 7 }), SESSION);
    assert.equal((await loadQ()).overriddenFrom?.difficulty, null);

    const second = parseToolResult(await tool.handler(args({ difficulty: 9 }), SESSION));
    assert.equal(second.originals.difficulty, null, "still 'never rated'");
  });

  it("tracks each field's original independently", async () => {
    await seed({ points: 2, difficulty: 4 });
    const tool = makeTool();

    await tool.handler(args({ points: 5 }), SESSION);
    await tool.handler(args({ difficulty: 9 }), SESSION);

    assert.deepEqual((await loadQ()).overriddenFrom, { points: 2, difficulty: 4 });
  });
});

describe("override_question — card repaint", () => {
  it("hands the stored blocks and the new value to the renderer, then persists its result", async () => {
    await seed({ points: 2, postedBlocks: POSTED_BLOCKS, messageLink: "https://x" });
    const res = parseToolResult(await makeTool().handler(args({ points: 3 }), SESSION));

    expect(rewriteWorthBlock).toHaveBeenCalledTimes(1);
    expect(rewriteWorthBlock).toHaveBeenCalledWith(POSTED_BLOCKS, 3, expect.anything());
    assert.deepEqual(
      (await loadQ()).postedBlocks,
      REWRITTEN_BLOCKS,
      "the renderer's output is what gets stored",
    );
    assert.ok(res.refreshHint.includes("refresh_question_cards"));
    assert.ok(res.refreshHint.includes("Q1"));
  });

  it("asks for a 1-point card when demoting, so the line is dropped", async () => {
    await seed({ points: 2, postedBlocks: POSTED_BLOCKS });
    await makeTool().handler(args({ points: 1 }), SESSION);

    expect(rewriteWorthBlock).toHaveBeenCalledWith(POSTED_BLOCKS, 1, expect.anything());
  });

  it("repaints when promoting a card that had no worth line", async () => {
    await seed({ postedBlocks: POSTED_BLOCKS });
    const res = parseToolResult(await makeTool().handler(args({ points: 2 }), SESSION));

    expect(rewriteWorthBlock).toHaveBeenCalledWith(POSTED_BLOCKS, 2, expect.anything());
    assert.ok(res.refreshHint !== undefined);
  });

  it("skips the renderer when the points value is unchanged", async () => {
    await seed({ points: 2, postedBlocks: POSTED_BLOCKS });
    const res = parseToolResult(await makeTool().handler(args({ points: 2 }), SESSION));

    expect(rewriteWorthBlock).not.toHaveBeenCalled();
    assert.equal(res.refreshHint, undefined, "nothing changed on the card");
  });

  it("skips the renderer on a staged (never-posted) question", async () => {
    await seed({ points: 2 });
    const res = parseToolResult(await makeTool().handler(args({ points: 3 }), SESSION));

    expect(rewriteWorthBlock).not.toHaveBeenCalled();
    assert.equal(res.refreshHint, undefined, "nothing is posted, so nothing to repaint");
    assert.equal((await loadQ()).postedBlocks, undefined);
  });
});

describe("override_question — rejections", () => {
  it("rejects an empty patch", async () => {
    await seed();
    const res = parseToolResult(await makeTool().handler(args(), SESSION));
    assert.ok(res.error || res.isError);
    assert.match(res.error ?? "", /at least one/);
  });

  it("rejects an unknown questionId and writes nothing", async () => {
    await seed();
    const res = parseToolResult(
      await makeTool().handler(args({ questionId: "nope", points: 2 }), SESSION),
    );
    assert.ok(res.error || res.isError);
    assert.equal((await loadQ()).points, undefined);
  });

  it("rejects an unknown game", async () => {
    await seed();
    const res = parseToolResult(
      await makeTool().handler(args({ game: "ghost", points: 2 }), SESSION),
    );
    assert.ok(res.error || res.isError);
  });
});

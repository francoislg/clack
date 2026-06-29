import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createInMemoryDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  multiFixtureGetGames,
} from "../../testHelpers.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };

type FindArgs = Parameters<ReturnType<typeof createFindPreviousQuestionsTool>["handler"]>[0];

function fullArgs(over: Partial<FindArgs>): FindArgs {
  return {
    games: undefined,
    categories: undefined,
    seasons: undefined,
    keywords: undefined,
    match: undefined,
    posted: undefined,
    recentBatchFromNow: undefined,
    limit: undefined,
    includeRevealBlocks: undefined,
    ...over,
  };
}

describe("find_previous_questions response shape (single game)", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "q1",
      category: "Science",
      statement: "Water boils at 100 degrees Celsius",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 1,
      postedAt: 1500,
      messageLink: "https://slack.com/archives/C/p1",
    });
    await scoped.saveQuestion({
      id: "q2",
      category: "Science",
      statement: "The Earth is flat",
      isTrue: false,
      emojis: ["🌍"],
      createdAt: 2,
    });
    await scoped.saveQuestion({
      id: "q3",
      category: "History",
      statement: "Rome was founded in 753 BC",
      isTrue: true,
      emojis: ["🏛️"],
      createdAt: 3,
    });
  });

  it("omits isTrue from every returned question (category-only search)", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Science"],
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.count, 2);
    for (const q of parsed.questions) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(q, "isTrue"),
        false,
        `question ${q.id} must not include isTrue`,
      );
      assert.equal(q.game, FIXTURE_GAME_NAME);
    }
  });

  it("keywords search returns only matching rows and stamps matchedKeywords", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["boils"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "q1");
    assert.deepEqual(parsed.questions[0].matchedKeywords, ["boils"]);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "isTrue"), false);
  });

  it("default match=all AND's keywords with categories", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Science"],
        seasons: undefined,
        keywords: ["Earth"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "q2");
    assert.deepEqual(parsed.questions[0].matchedKeywords, ["Earth"]);
  });

  it("returns the search-safe field set including game and matchedKeywords", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["boils"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.deepEqual(Object.keys(parsed.questions[0]).sort(), [
      "category",
      "createdAt",
      "emojis",
      "game",
      "id",
      "matchedKeywords",
      "messageLink",
      "postedAt",
      "statement",
    ]);
  });

  it("surfaces promptMedium and media on image-medium questions (the posting run needs them)", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "img1",
      category: "Geography",
      statement: "Which landmark is shown?",
      answersFormat: "freeform",
      expectedAnswer: "Eiffel Tower",
      promptMedium: "image",
      media: {
        kind: "image",
        url: "https://upload.wikimedia.org/x/thumb.jpg",
        altText: "a landmark",
        subjectId: "wikidata:Q243",
        title: "Eiffel Tower",
        license: "CC-BY-SA 4.0",
        attribution: "via Wikimedia Commons",
      },
      emojis: ["🗼"],
      createdAt: 10,
    });

    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Geography"],
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const q = parseToolResult(result).questions[0];
    assert.equal(q.promptMedium, "image");
    assert.deepEqual(q.media, {
      kind: "image",
      url: "https://upload.wikimedia.org/x/thumb.jpg",
      altText: "a landmark",
      subjectId: "wikidata:Q243",
      title: "Eiffel Tower",
      license: "CC-BY-SA 4.0",
      attribution: "via Wikimedia Commons",
    });
  });

  it("omits promptMedium and media on text-medium questions", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["History"],
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const q = parseToolResult(result).questions[0];
    assert.equal("promptMedium" in q, false);
    assert.equal("media" in q, false);
  });

  it("omits postedAt, messageLink, and matchedKeywords when not applicable", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Science"],
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q2 = parsed.questions.find((q: { id: string }) => q.id === "q2");
    assert.equal(Object.prototype.hasOwnProperty.call(q2, "postedAt"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q2, "messageLink"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q2, "matchedKeywords"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q2, "isTrue"), false);
  });

  it("returns empty array for no matches", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Science"],
        seasons: undefined,
        keywords: ["Rome"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.questions, []);
  });
});

describe("find_previous_questions per-format response shape", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "qc1",
      answersFormat: "choice",
      category: "Geography",
      statement: "Which is the smallest planet?",
      choices: ["Mercury", "Venus", "Earth", "Mars"],
      correctIndex: 0,
      emojis: ["🪐"],
      createdAt: 100,
    });
    await scoped.saveQuestion({
      id: "qb1",
      answersFormat: "boolean",
      category: "Geography",
      statement: "The Earth is round.",
      isTrue: true,
      emojis: ["🌍"],
      createdAt: 200,
    });
  });

  it("choice rows include answersFormat and choices, never correctIndex or isTrue", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["planet"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.answersFormat, "choice");
    assert.deepEqual(q.choices, ["Mercury", "Venus", "Earth", "Mars"]);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "correctIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
    assert.equal(q.game, FIXTURE_GAME_NAME);
  });

  it("boolean rows include answersFormat but never choices/correctIndex/isTrue", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["Earth is round"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.answersFormat, "boolean");
    assert.equal(Object.prototype.hasOwnProperty.call(q, "choices"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "correctIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
  });

  it("freeform rows never carry expectedAnswer/acceptableAnswers/gradingNotes", async () => {
    const local = createInMemoryDataLayer();
    const scoped = local.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "qf1",
      answersFormat: "freeform",
      category: "Geography",
      statement: "What is the capital of France?",
      expectedAnswer: "Paris",
      acceptableAnswers: ["Paris, France"],
      gradingNotes: "Accept any English-language form.",
      emojis: ["🗺️"],
      createdAt: 1,
    });
    const tool = createFindPreviousQuestionsTool(local, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["france"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.answersFormat, "freeform");
    assert.equal(Object.prototype.hasOwnProperty.call(q, "expectedAnswer"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "acceptableAnswers"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "gradingNotes"), false);
    assert.deepEqual(q.matchedKeywords, ["france"]);
  });

  it("surfaces processedAt, season, slot, suggestedDifficulty, and difficulty when set", async () => {
    const local = createInMemoryDataLayer();
    const scoped = local.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "qx",
      answersFormat: "boolean",
      category: "Science",
      statement: "Water is wet.",
      isTrue: true,
      emojis: ["💧"],
      createdAt: 10,
      postedAt: 20,
      messageLink: "https://slack.com/archives/C/p20",
      processedAt: 30,
      season: "season-2026-05",
      slot: { index: 1, label: "Mid" },
      suggestedDifficulty: "Medium",
      difficulty: 5,
    });

    const tool = createFindPreviousQuestionsTool(local, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["wet"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.processedAt, 30);
    assert.equal(q.season, "season-2026-05");
    assert.deepEqual(q.slot, { index: 1, label: "Mid" });
    assert.equal(q.suggestedDifficulty, "Medium");
    assert.equal(q.difficulty, 5);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
  });
});

describe("find_previous_questions keyword haystack", () => {
  function args(overrides: { keywords?: string[]; categories?: string[] }) {
    return {
      games: [FIXTURE_GAME_NAME],
      categories: overrides.categories,
      seasons: undefined,
      keywords: overrides.keywords,
      match: undefined,
      posted: undefined,
      recentBatchFromNow: undefined,
      limit: undefined,
      includeRevealBlocks: undefined,
    };
  }

  it("matches a choice option absent from the statement", async () => {
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "qc",
      answersFormat: "choice",
      category: "Sports",
      statement: "Which nation lifted the trophy in 1998?",
      choices: ["France", "Brazil", "Italy", "Germany"],
      correctIndex: 0,
      emojis: ["⚽"],
      createdAt: 1,
    });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args({ keywords: ["brazil"] }), SESSION));
    assert.equal(parsed.questions.length, 1);
    assert.deepEqual(parsed.questions[0].matchedKeywords, ["brazil"]);
  });

  it("matches a freeform answer field absent from the statement without leaking it", async () => {
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "qf",
      answersFormat: "freeform",
      category: "Art",
      statement: "Name the painter of the Mona Lisa.",
      expectedAnswer: "Leonardo da Vinci",
      acceptableAnswers: ["da Vinci"],
      gradingNotes: "Accept the surname alone.",
      emojis: ["🎨"],
      createdAt: 1,
    });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args({ keywords: ["leonardo"] }), SESSION));
    assert.equal(parsed.questions.length, 1);
    const q = parsed.questions[0];
    assert.deepEqual(q.matchedKeywords, ["leonardo"]);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "expectedAnswer"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "acceptableAnswers"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "gradingNotes"), false);
  });

  it("matches a boolean row only via its statement", async () => {
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "qb",
      answersFormat: "boolean",
      category: "Geography",
      statement: "The Great Wall of China is visible from space.",
      isTrue: false,
      emojis: ["🧱"],
      createdAt: 1,
    });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const hit = parseToolResult(await tool.handler(args({ keywords: ["space"] }), SESSION));
    assert.equal(hit.questions.length, 1);
    const miss = parseToolResult(await tool.handler(args({ keywords: ["orbit"] }), SESSION));
    assert.equal(miss.questions.length, 0);
  });

  it("matches an image question via its media title/altText (cross-medium dedup)", async () => {
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "qi",
      answersFormat: "choice",
      promptMedium: "image",
      category: "Landmarks",
      statement: "Which landmark is shown?",
      choices: ["Eiffel Tower", "Big Ben", "Colosseum", "Brandenburg Gate"],
      correctIndex: 0,
      media: {
        kind: "image",
        url: "https://example.org/eiffel.jpg",
        altText: "A wrought-iron lattice tower beside the Seine",
        subjectId: "wikidata:Q243",
        title: "Eiffel Tower",
      },
      emojis: ["🗼"],
      createdAt: 1,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "qt",
      answersFormat: "boolean",
      category: "Science",
      statement: "Photosynthesis converts light into chemical energy.",
      isTrue: true,
      emojis: ["🌱"],
      createdAt: 2,
    });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args({ keywords: ["seine"] }), SESSION));
    assert.equal(parsed.questions.length, 1);
    assert.equal(parsed.questions[0].id, "qi");
    assert.deepEqual(parsed.questions[0].matchedKeywords, ["seine"]);
  });

  it("does not match a row solely by its category", async () => {
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "qcat",
      answersFormat: "boolean",
      category: "Geography",
      statement: "The Nile is the longest river in Africa.",
      isTrue: true,
      emojis: ["🌍"],
      createdAt: 1,
    });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const byKeyword = parseToolResult(
      await tool.handler(args({ keywords: ["geography"] }), SESSION),
    );
    assert.equal(byKeyword.questions.length, 0);
    const byCriterion = parseToolResult(
      await tool.handler(args({ categories: ["Geography"] }), SESSION),
    );
    assert.equal(byCriterion.questions.length, 1);
  });
});

describe("find_previous_questions — revealBlocks opt-in exposure", () => {
  const narrative = [
    {
      type: "section" as const,
      block_id: "narrative:q1",
      text: { type: "mrkdwn" as const, text: "the why" },
    },
  ];

  function args(overrides: { includeRevealBlocks?: boolean }) {
    return {
      games: [FIXTURE_GAME_NAME],
      categories: undefined,
      seasons: undefined,
      keywords: undefined,
      match: undefined,
      posted: undefined,
      recentBatchFromNow: undefined,
      limit: undefined,
      includeRevealBlocks: overrides.includeRevealBlocks,
    };
  }

  async function seedRevealed(data: TriviaDataLayer) {
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "q1",
      category: "Science",
      statement: "Water boils at 100C",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 1,
      postedAt: 1500,
      processedAt: 2000,
      messageLink: "https://slack.com/archives/C/p1",
      revealBlocks: narrative,
    });
  }

  it("default (no opt-in) omits revealBlocks even for a revealed question", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealed(data);
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args({}), SESSION));
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "revealBlocks"), false);
  });

  it("opt-in returns revealBlocks for a revealed question", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealed(data);
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(args({ includeRevealBlocks: true }), SESSION),
    );
    assert.equal(parsed.questions[0].revealBlocks.length, 1);
    assert.equal(parsed.questions[0].revealBlocks[0].block_id, "narrative:q1");
  });

  it("opt-in still withholds revealBlocks for a live (unrevealed) question", async () => {
    const data = createInMemoryDataLayer();
    // Posted but NOT revealed (processedAt absent) — carries revealBlocks but must stay hidden.
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "q2",
      category: "Science",
      statement: "Live one",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 2,
      postedAt: 1500,
      messageLink: "https://slack.com/archives/C/p2",
      revealBlocks: narrative,
    });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(args({ includeRevealBlocks: true }), SESSION),
    );
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "revealBlocks"), false);
  });

  it("opt-in omits revealBlocks for a revealed question that has none stored", async () => {
    const data = createInMemoryDataLayer();
    // Revealed (processedAt set) but authored under "no" mode → no revealBlocks. Must omit, not error.
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "q1",
      category: "Science",
      statement: "Facts-only reveal",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 1,
      postedAt: 1500,
      processedAt: 2000,
      messageLink: "https://slack.com/archives/C/p1",
    });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(args({ includeRevealBlocks: true }), SESSION),
    );
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "revealBlocks"), false);
  });
});

interface FactRow {
  id: string;
  batchPending?: boolean;
  batchIsLatest?: boolean;
}

describe("find_previous_questions batch facts (batchPending / batchIsLatest, never batchId)", () => {
  function postedQ(over: { id: string; postedAt: number; batchId: string; processedAt?: number }) {
    return {
      category: "C",
      statement: over.id,
      isTrue: true,
      emojis: ["🎯"],
      createdAt: 1,
      ...over,
    };
  }

  it("marks a live latest batch as pending and latest, and never returns batchId", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(postedQ({ id: "q1", postedAt: 1000, batchId: "B" }));
    await scoped.saveQuestion(postedQ({ id: "q2", postedAt: 1001, batchId: "B" }));

    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(fullArgs({ games: [FIXTURE_GAME_NAME] }), SESSION),
    );
    const q1 = parsed.questions.find((q: FactRow) => q.id === "q1");
    assert.equal(q1.batchPending, true);
    assert.equal(q1.batchIsLatest, true);
    assert.equal(Object.prototype.hasOwnProperty.call(q1, "batchId"), false);
  });

  it("marks an older revealed batch as neither pending nor latest", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      postedQ({ id: "old", postedAt: 1000, processedAt: 5000, batchId: "A" }),
    );
    await scoped.saveQuestion(postedQ({ id: "new", postedAt: 2000, batchId: "B" }));

    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(fullArgs({ games: [FIXTURE_GAME_NAME] }), SESSION),
    );
    const oldQ = parsed.questions.find((q: FactRow) => q.id === "old");
    const newQ = parsed.questions.find((q: FactRow) => q.id === "new");
    assert.equal(oldQ.batchPending, false);
    assert.equal(oldQ.batchIsLatest, false);
    assert.equal(newQ.batchPending, true);
    assert.equal(newQ.batchIsLatest, true);
  });

  it("computes batchIsLatest per game in a cross-game scan", async () => {
    const data = createInMemoryDataLayer();
    // main: M1 @100, M2 @200 → M2 latest. sandbox: S1 @150 → its own game's latest.
    await data.forGame("main").saveQuestion(postedQ({ id: "M1", postedAt: 100, batchId: "M1" }));
    await data.forGame("main").saveQuestion(postedQ({ id: "M2", postedAt: 200, batchId: "M2" }));
    await data.forGame("sandbox").saveQuestion(postedQ({ id: "S1", postedAt: 150, batchId: "S1" }));

    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const parsed = parseToolResult(await tool.handler(fullArgs({}), SESSION));
    assert.equal(parsed.questions.find((q: FactRow) => q.id === "M2").batchIsLatest, true);
    assert.equal(parsed.questions.find((q: FactRow) => q.id === "M1").batchIsLatest, false);
    assert.equal(parsed.questions.find((q: FactRow) => q.id === "S1").batchIsLatest, true);
  });

  it("omits batch facts for a staged (unposted) row", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "staged",
      category: "C",
      statement: "not posted",
      isTrue: true,
      emojis: ["🎯"],
      createdAt: 1,
    });

    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(fullArgs({ games: [FIXTURE_GAME_NAME], posted: false }), SESSION),
    );
    const staged = parsed.questions.find((q: FactRow) => q.id === "staged");
    assert.equal(Object.prototype.hasOwnProperty.call(staged, "batchPending"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(staged, "batchIsLatest"), false);
  });
});

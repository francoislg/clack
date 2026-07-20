import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  multiFixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";

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
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;

    const q1 = {
      id: "q1",
      category: "Science",
      statement: "Water boils at 100 degrees Celsius",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 1,
      postedAt: 1500,
      messageLink: "https://slack.com/archives/C/p1",
    };
    const q2 = {
      id: "q2",
      category: "Science",
      statement: "The Earth is flat",
      isTrue: false,
      emojis: ["🌍"],
      createdAt: 2,
    };
    const q3 = {
      id: "q3",
      category: "History",
      statement: "Rome was founded in 753 BC",
      isTrue: true,
      emojis: ["🏛️"],
      createdAt: 3,
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([q1, q2, q3]);
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
    const imgQ = {
      id: "img1",
      category: "Geography",
      statement: "Which landmark is shown?",
      answersFormat: "freeform" as const,
      expectedAnswer: "Eiffel Tower",
      promptMedium: "image" as const,
      media: {
        kind: "image" as const,
        url: "https://upload.wikimedia.org/x/thumb.jpg",
        altText: "a landmark",
        subjectId: "wikidata:Q243",
        title: "Eiffel Tower",
        license: "CC-BY-SA 4.0",
        attribution: "via Wikimedia Commons",
      },
      emojis: ["🗼"],
      createdAt: 10,
    };

    const existing = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([...(existing || []), imgQ]);

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

interface PointsRow {
  id: string;
  points?: number;
  difficulty?: number;
  overriddenFrom?: { points?: number; difficulty?: number | null };
}

describe("find_previous_questions — points and override originals", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;

    const weighted = {
      id: "weighted",
      category: "Science",
      statement: "A weighted question",
      isTrue: true,
      emojis: ["⭐"],
      createdAt: 1,
      points: 3,
    };
    const ordinary = {
      id: "ordinary",
      category: "Science",
      statement: "An ordinary question",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 2,
    };
    const reclassed = {
      id: "reclassed",
      category: "Science",
      statement: "A reclassed question",
      isTrue: true,
      emojis: ["🛠️"],
      createdAt: 3,
      points: 2,
      difficulty: 8,
      overriddenFrom: { points: 1, difficulty: null },
    };
    data
      .forGame(FIXTURE_GAME_NAME)
      .loadQuestions.mockResolvedValue([weighted, ordinary, reclassed]);
  });

  async function findById(id: string): Promise<PointsRow> {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(fullArgs({ games: [FIXTURE_GAME_NAME] }), SESSION),
    );
    const row = parsed.questions.find((q: PointsRow) => q.id === id);
    assert.ok(row, `question ${id} missing from results`);
    return row;
  }

  it("surfaces the stamped points on a weighted question", async () => {
    assert.equal((await findById("weighted")).points, 3);
  });

  it("omits points on a 1-point question, since absence reads as 1", async () => {
    const row = await findById("ordinary");
    assert.equal(Object.prototype.hasOwnProperty.call(row, "points"), false);
  });

  it("surfaces captured originals so the generation-time value stays auditable", async () => {
    const row = await findById("reclassed");
    assert.equal(row.points, 2);
    assert.equal(row.difficulty, 8);
    assert.deepEqual(row.overriddenFrom, { points: 1, difficulty: null });
  });

  it("omits overriddenFrom on a question that was never overridden", async () => {
    const row = await findById("weighted");
    assert.equal(Object.prototype.hasOwnProperty.call(row, "overriddenFrom"), false);
  });
});

describe("find_previous_questions per-format response shape", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;

    const qc1 = {
      id: "qc1",
      answersFormat: "choice" as const,
      category: "Geography",
      statement: "Which is the smallest planet?",
      choices: ["Mercury", "Venus", "Earth", "Mars"],
      correctIndex: 0,
      emojis: ["🪐"],
      createdAt: 100,
    };
    const qb1 = {
      id: "qb1",
      answersFormat: "boolean" as const,
      category: "Geography",
      statement: "The Earth is round.",
      isTrue: true,
      emojis: ["🌍"],
      createdAt: 200,
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([qc1, qb1]);
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
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: local } = createTriviaDataLayer(sdk);

    const qf1 = {
      id: "qf1",
      answersFormat: "freeform" as const,
      category: "Geography",
      statement: "What is the capital of France?",
      expectedAnswer: "Paris",
      acceptableAnswers: ["Paris, France"],
      gradingNotes: "Accept any English-language form.",
      emojis: ["🗺️"],
      createdAt: 1,
    };
    local.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([qf1]);
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
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: local } = createTriviaDataLayer(sdk);

    const qx = {
      id: "qx",
      answersFormat: "boolean" as const,
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
      suggestedDifficulty: "Medium" as const,
      difficulty: 5,
    };
    local.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([qx]);

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
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const qc = {
      id: "qc",
      answersFormat: "choice" as const,
      category: "Sports",
      statement: "Which nation lifted the trophy in 1998?",
      choices: ["France", "Brazil", "Italy", "Germany"],
      correctIndex: 0,
      emojis: ["⚽"],
      createdAt: 1,
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([qc]);
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args({ keywords: ["brazil"] }), SESSION));
    assert.equal(parsed.questions.length, 1);
    assert.deepEqual(parsed.questions[0].matchedKeywords, ["brazil"]);
  });

  it("matches a freeform answer field absent from the statement without leaking it", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const qf = {
      id: "qf",
      answersFormat: "freeform" as const,
      category: "Art",
      statement: "Name the painter of the Mona Lisa.",
      expectedAnswer: "Leonardo da Vinci",
      acceptableAnswers: ["da Vinci"],
      gradingNotes: "Accept the surname alone.",
      emojis: ["🎨"],
      createdAt: 1,
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([qf]);
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
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const qb = {
      id: "qb",
      answersFormat: "boolean" as const,
      category: "Geography",
      statement: "The Great Wall of China is visible from space.",
      isTrue: false,
      emojis: ["🧱"],
      createdAt: 1,
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([qb]);
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const hit = parseToolResult(await tool.handler(args({ keywords: ["space"] }), SESSION));
    assert.equal(hit.questions.length, 1);
    const miss = parseToolResult(await tool.handler(args({ keywords: ["orbit"] }), SESSION));
    assert.equal(miss.questions.length, 0);
  });

  it("matches an image question via its media title/altText (cross-medium dedup)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const qi = {
      id: "qi",
      answersFormat: "choice" as const,
      promptMedium: "image" as const,
      category: "Landmarks",
      statement: "Which landmark is shown?",
      choices: ["Eiffel Tower", "Big Ben", "Colosseum", "Brandenburg Gate"],
      correctIndex: 0,
      media: {
        kind: "image" as const,
        url: "https://example.org/eiffel.jpg",
        altText: "A wrought-iron lattice tower beside the Seine",
        subjectId: "wikidata:Q243",
        title: "Eiffel Tower",
      },
      emojis: ["🗼"],
      createdAt: 1,
    };
    const qt = {
      id: "qt",
      answersFormat: "boolean" as const,
      category: "Science",
      statement: "Photosynthesis converts light into chemical energy.",
      isTrue: true,
      emojis: ["🌱"],
      createdAt: 2,
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([qi, qt]);
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args({ keywords: ["seine"] }), SESSION));
    assert.equal(parsed.questions.length, 1);
    assert.equal(parsed.questions[0].id, "qi");
    assert.deepEqual(parsed.questions[0].matchedKeywords, ["seine"]);
  });

  it("does not match a row solely by its category", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const qcat = {
      id: "qcat",
      answersFormat: "boolean" as const,
      category: "Geography",
      statement: "The Nile is the longest river in Africa.",
      isTrue: true,
      emojis: ["🌍"],
      createdAt: 1,
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([qcat]);
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

  async function seedRevealed(data: FakeTriviaDataLayer) {
    const q1 = {
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
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([q1]);
  }

  it("default (no opt-in) omits revealBlocks even for a revealed question", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    await seedRevealed(data);
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args({}), SESSION));
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "revealBlocks"), false);
  });

  it("opt-in returns revealBlocks for a revealed question", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    await seedRevealed(data);
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(args({ includeRevealBlocks: true }), SESSION),
    );
    assert.equal(parsed.questions[0].revealBlocks.length, 1);
    assert.equal(parsed.questions[0].revealBlocks[0].block_id, "narrative:q1");
  });

  it("opt-in still withholds revealBlocks for a live (unrevealed) question", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    // Posted but NOT revealed (processedAt absent) — carries revealBlocks but must stay hidden.
    const q2 = {
      id: "q2",
      category: "Science",
      statement: "Live one",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 2,
      postedAt: 1500,
      messageLink: "https://slack.com/archives/C/p2",
      revealBlocks: narrative,
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([q2]);
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(args({ includeRevealBlocks: true }), SESSION),
    );
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "revealBlocks"), false);
  });

  it("opt-in omits revealBlocks for a revealed question that has none stored", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const qNoReveal = {
      id: "q1",
      category: "Science",
      statement: "Facts-only reveal",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 1,
      postedAt: 1500,
      processedAt: 2000,
      messageLink: "https://slack.com/archives/C/p1",
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([qNoReveal]);
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
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const q1Seed = postedQ({ id: "q1", postedAt: 1000, batchId: "B" });
    const q2Seed = postedQ({ id: "q2", postedAt: 1001, batchId: "B" });
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([q1Seed, q2Seed]);

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
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const old = postedQ({ id: "old", postedAt: 1000, processedAt: 5000, batchId: "A" });
    const newer = postedQ({ id: "new", postedAt: 2000, batchId: "B" });
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([old, newer]);

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
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const m1 = postedQ({ id: "M1", postedAt: 100, batchId: "M1" });
    const m2 = postedQ({ id: "M2", postedAt: 200, batchId: "M2" });
    const s1 = postedQ({ id: "S1", postedAt: 150, batchId: "S1" });

    data.forGame("main").loadQuestions.mockResolvedValue([m1, m2]);
    data.forGame("sandbox").loadQuestions.mockResolvedValue([s1]);

    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const parsed = parseToolResult(await tool.handler(fullArgs({}), SESSION));
    assert.equal(parsed.questions.find((q: FactRow) => q.id === "M2").batchIsLatest, true);
    assert.equal(parsed.questions.find((q: FactRow) => q.id === "M1").batchIsLatest, false);
    assert.equal(parsed.questions.find((q: FactRow) => q.id === "S1").batchIsLatest, true);
  });

  it("omits batch facts for a staged (unposted) row", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);

    const staged = {
      id: "staged",
      category: "C",
      statement: "not posted",
      isTrue: true,
      emojis: ["🎯"],
      createdAt: 1,
    };
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([staged]);

    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(fullArgs({ games: [FIXTURE_GAME_NAME], posted: false }), SESSION),
    );
    const stagedRow = parsed.questions.find((q: FactRow) => q.id === "staged");
    assert.equal(Object.prototype.hasOwnProperty.call(stagedRow, "batchPending"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stagedRow, "batchIsLatest"), false);
  });
});

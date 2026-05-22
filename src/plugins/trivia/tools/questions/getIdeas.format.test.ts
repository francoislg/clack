import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { Config } from "../../../../config.js";
import type { TriviaDataLayer, SeasonEntry } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function makeConfig(trivia: Config["trivia"]): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: [],
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "sonnet" },
    trivia,
  };
}

const SEASONS_ON_CONFIG = makeConfig({
  seasons: { enabled: true, prompt: "Monthly" },
  answersFormat: { boolean: 1, choice: 0, freeform: 0 },
});

async function seedSeason(
  data: TriviaDataLayer,
  overrides: Partial<SeasonEntry> = {},
): Promise<SeasonEntry> {
  const now = Date.now();
  const entry: SeasonEntry = {
    slug: "active",
    startedAt: now - 10 * DAY,
    expectedEndAt: now + 20 * DAY,
    categories: ["Science", "History", "Geography", "Sports", "Art"],
    ...overrides,
  };
  await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({ seasons: [entry] });
  return entry;
}

describe("get_ideas — format meta and slot routing", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Baseline-1", "Baseline-2"]);
  });

  it("returns format: null when active season has no format", async () => {
    await seedSeason(data);
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.format, null);
    assert.equal(parsed.slot, 0);
  });

  it("returns format meta when active season has format", async () => {
    await seedSeason(data, {
      format: {
        questions: [{ label: "Q1" }, { label: "History Choice", categories: ["History"] }],
      },
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.format.slotCount, 2);
    assert.equal(parsed.format.slots.length, 2);
    assert.equal(parsed.format.slots[0].index, 0);
    assert.equal(parsed.format.slots[0].label, "Q1");
    // Slot 0 has no own categories → resolved pool is the season's
    assert.deepEqual(parsed.format.slots[0].categories, [
      "Science",
      "History",
      "Geography",
      "Sports",
      "Art",
    ]);
    // Slot 1 has its own categories
    assert.deepEqual(parsed.format.slots[1].categories, ["History"]);
  });

  it("routes category pool through the slot's resolved categories", async () => {
    await seedSeason(data, {
      format: {
        questions: [{}, { categories: ["History"] }],
      },
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 1 }, SESSION),
    );
    assert.equal(parsed.slot, 1);
    assert.equal(parsed.categories.total, 1);
    assert.deepEqual(parsed.categories.ideas, ["History"]);
  });

  it("rejects slot out of range", async () => {
    await seedSeason(data, {
      format: { questions: [{}, {}] },
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 5 }, SESSION),
    );
    assert.match(parsed.error, /out of range/);
  });

  it("rejects non-zero slot when season has no format", async () => {
    await seedSeason(data);
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 1 }, SESSION),
    );
    assert.match(parsed.error, /no format/);
  });

  it("accepts slot 0 when season has no format (backward compat)", async () => {
    await seedSeason(data);
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
    );
    assert.equal(parsed.slot, 0);
    assert.ok(parsed.categories);
  });

  it("uses slot.answersFormat when set (overrides season answersFormat)", async () => {
    await seedSeason(data, {
      answersFormat: { boolean: 1, choice: 0, freeform: 0 },
      format: {
        questions: [{ answersFormat: { boolean: 0, choice: 1, freeform: 0 } }],
      },
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    // Run several times; with deterministic weights the type roll is constant
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedAnswersFormat, "choice", `iteration ${i}`);
    }
  });

  it("falls back to season.answersFormat when slot has none", async () => {
    await seedSeason(data, {
      answersFormat: { boolean: 0, choice: 1, freeform: 0 },
      format: { questions: [{}] },
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedAnswersFormat, "choice", `iteration ${i}`);
    }
  });

  it("falls back to config when neither slot nor season has answersFormat", async () => {
    await seedSeason(data, {
      format: { questions: [{}] },
    });
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "Monthly" },
      answersFormat: { boolean: 0, choice: 1, freeform: 0 },
    });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedAnswersFormat, "choice", `iteration ${i}`);
    }
  });

  it("echoes slot in the response", async () => {
    await seedSeason(data, {
      format: { questions: [{}, {}, {}] },
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    for (const slot of [0, 1, 2]) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot }, SESSION),
      );
      assert.equal(parsed.slot, slot);
    }
  });

  it("format meta is stable across calls in the same season", async () => {
    await seedSeason(data, {
      format: { questions: [{ label: "A" }, { label: "B" }] },
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const a = parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION));
    const b = parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME, slot: 1 }, SESSION));
    assert.deepEqual(a.format, b.format);
  });
});

describe("get_ideas — suggestedAnswerShape (freeform branch)", () => {
  let data: TriviaDataLayer;
  const FREEFORM_CONFIG = makeConfig({
    seasons: { enabled: true, prompt: "Monthly" },
    answersFormat: { boolean: 0, choice: 0, freeform: 1 },
  });

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Baseline-1", "Baseline-2"]);
  });

  it("is omitted on boolean / choice branches", async () => {
    await seedSeason(data);
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedAnswersFormat, "boolean");
    assert.equal(parsed.suggestedAnswerShape, undefined);
  });

  it("rolls one of the legal shapes on freeform with uniform default", async () => {
    await seedSeason(data);
    const tool = createGetIdeasTool(data, () => FREEFORM_CONFIG, fixtureGetGames);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      assert.equal(parsed.suggestedAnswersFormat, "freeform");
      assert.ok(
        ["name", "place", "phrase", "title", "date", "number", "other"].includes(
          parsed.suggestedAnswerShape,
        ),
        `unexpected shape: ${parsed.suggestedAnswerShape}`,
      );
      seen.add(parsed.suggestedAnswerShape);
    }
    assert.ok(seen.size > 1, `uniform default should hit multiple shapes — only saw ${[...seen]}`);
  });

  it("honors slot.answerShape (overrides season + config)", async () => {
    await seedSeason(data, {
      answerShape: { name: 0, place: 0, phrase: 0, title: 0, date: 1, number: 0, other: 0 },
      format: {
        questions: [
          {
            answerShape: {
              name: 1,
              place: 0,
              phrase: 0,
              title: 0,
              date: 0,
              number: 0,
              other: 0,
            },
          },
        ],
      },
    });
    const tool = createGetIdeasTool(data, () => FREEFORM_CONFIG, fixtureGetGames);
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedAnswerShape, "name", `iteration ${i}`);
    }
  });

  it("falls back to season.answerShape when slot has none", async () => {
    await seedSeason(data, {
      answerShape: { name: 0, place: 1, phrase: 0, title: 0, date: 0, number: 0, other: 0 },
      format: { questions: [{}] },
    });
    const tool = createGetIdeasTool(data, () => FREEFORM_CONFIG, fixtureGetGames);
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedAnswerShape, "place", `iteration ${i}`);
    }
  });

  it("falls back to config.trivia.answerShape when neither slot nor season has it", async () => {
    await seedSeason(data, {
      format: { questions: [{}] },
    });
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "Monthly" },
      answersFormat: { boolean: 0, choice: 0, freeform: 1 },
      answerShape: { name: 0, place: 0, phrase: 1, title: 0, date: 0, number: 0, other: 0 },
    });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedAnswerShape, "phrase", `iteration ${i}`);
    }
  });
});

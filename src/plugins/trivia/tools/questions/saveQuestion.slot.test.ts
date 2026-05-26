import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaConfig } from "../../core/configTypes.js";
import type { TriviaDataLayer, SeasonEntry } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function makeConfig(trivia: TriviaConfig): TriviaConfig {
  return trivia;
}

const SEASONS_ON = makeConfig({
  seasons: { enabled: true, prompt: "Monthly" },
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
    categories: ["Science", "History", "Geography"],
    ...overrides,
  };
  await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({ seasons: [entry] });
  return entry;
}

const BASE_ARGS = {
  game: FIXTURE_GAME_NAME,
  answersFormat: "boolean" as const,
  questionType: "fact" as const,
  category: "Science",
  statement: "Water boils at 100 C at sea level.",
  isTrue: true,
  sourceUrl: undefined,
  eventDate: undefined,
  context: undefined,
  choices: undefined,
  correctIndex: undefined,
  expectedAnswer: undefined,
  acceptableAnswers: undefined,
  gradingNotes: undefined,
  freeformAnswerShape: undefined,
  suggestedDifficulty: undefined,
  difficulty: undefined,
  emojis: ["💧"],
};

describe("save_question — slot binding", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("rejects slot when active season has no format", async () => {
    await seedSeason(data);
    const tool = createSaveQuestionTool(data, () => SEASONS_ON, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ ...BASE_ARGS, slot: { index: 0, label: undefined } }, SESSION),
    );
    assert.match(parsed.error, /no active format/);
  });

  it("requires slot when active season has a format", async () => {
    await seedSeason(data, { format: { questions: [{ label: "A" }, { label: "B" }] } });
    const tool = createSaveQuestionTool(data, () => SEASONS_ON, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler({ ...BASE_ARGS, slot: undefined }, SESSION));
    assert.match(parsed.error, /requires a slot/);
  });

  it("rejects slot index out of range", async () => {
    await seedSeason(data, { format: { questions: [{}] } });
    const tool = createSaveQuestionTool(data, () => SEASONS_ON, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ ...BASE_ARGS, slot: { index: 5, label: undefined } }, SESSION),
    );
    assert.match(parsed.error, /out of range/);
  });

  it("rejects question whose type is not permitted by the slot", async () => {
    await seedSeason(data, {
      format: { questions: [{ answersFormat: { boolean: 0, choice: 1, freeform: 0 } }] },
    });
    const tool = createSaveQuestionTool(data, () => SEASONS_ON, fixtureGetGames);
    // Boolean question into a choice-only slot
    const parsed = parseToolResult(
      await tool.handler({ ...BASE_ARGS, slot: { index: 0, label: undefined } }, SESSION),
    );
    assert.match(parsed.error, /does not permit/);
  });

  it("rejects category not in slot's narrowed pool", async () => {
    await seedSeason(data, {
      format: { questions: [{ categories: ["History"] }] }, // narrows to History only
    });
    const tool = createSaveQuestionTool(data, () => SEASONS_ON, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { ...BASE_ARGS, category: "Science", slot: { index: 0, label: undefined } },
        SESSION,
      ),
    );
    assert.match(parsed.error, /not in slot/);
  });

  it("saves and snapshots the slot label from format (not from caller)", async () => {
    await seedSeason(data, {
      format: { questions: [{ label: "Real Label" }, { label: "Other" }] },
    });
    const tool = createSaveQuestionTool(data, () => SEASONS_ON, fixtureGetGames);
    const result = await tool.handler(
      {
        ...BASE_ARGS,
        category: "Science",
        slot: { index: 0, label: "MISLEADING CALLER LABEL" },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.slot.index, 0);
    assert.equal(parsed.question.slot.label, "Real Label"); // from format, not caller

    const questions = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    assert.equal(questions.length, 1);
    assert.equal(questions[0].slot?.index, 0);
    assert.equal(questions[0].slot?.label, "Real Label");
  });

  it("saves without slot field when season has no format", async () => {
    await seedSeason(data);
    const tool = createSaveQuestionTool(data, () => SEASONS_ON, fixtureGetGames);
    const result = await tool.handler({ ...BASE_ARGS, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.slot, undefined);
  });

  it("slot has no label → saved record has no label", async () => {
    await seedSeason(data, {
      format: { questions: [{}] }, // empty slot
    });
    const tool = createSaveQuestionTool(data, () => SEASONS_ON, fixtureGetGames);
    const result = await tool.handler(
      {
        ...BASE_ARGS,
        category: "Science",
        slot: { index: 0, label: undefined },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.question.slot.index, 0);
    assert.equal(parsed.question.slot.label, undefined);
  });

  it("game.format triggers slot-binding mode when season has none", async () => {
    await seedSeason(data); // season with no format
    const gamesWithFormat = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C100000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        format: { questions: [{ label: "GameSlot" }] },
      },
    ];
    const tool = createSaveQuestionTool(
      data,
      () => SEASONS_ON,
      () => gamesWithFormat,
    );
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...BASE_ARGS,
          slot: { index: 0, label: undefined },
        },
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.slot.index, 0);
    assert.equal(parsed.question.slot.label, "GameSlot");
  });

  it("rejects missing slot when game.format is the active format", async () => {
    await seedSeason(data);
    const gamesWithFormat = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C100000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        format: { questions: [{ label: "GameSlot" }] },
      },
    ];
    const tool = createSaveQuestionTool(
      data,
      () => SEASONS_ON,
      () => gamesWithFormat,
    );
    const parsed = parseToolResult(await tool.handler({ ...BASE_ARGS, slot: undefined }, SESSION));
    assert.match(parsed.error, /requires a slot argument/);
  });
});

describe("save_question — game-tier categories cascade", () => {
  const SEASONS_OFF = makeConfig({ seasons: { enabled: false, prompt: "" } });
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("game.categories narrows pool when seasons disabled", async () => {
    const gamesWithCategories = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C100000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        categories: ["History"],
      },
    ];
    const tool = createSaveQuestionTool(
      data,
      () => SEASONS_OFF,
      () => gamesWithCategories,
    );
    const parsed = parseToolResult(
      await tool.handler({ ...BASE_ARGS, category: "Science", slot: undefined }, SESSION),
    );
    assert.match(parsed.error, /not found in the pool|not in/);
  });

  it("falls through to global categories.json when game has none", async () => {
    const tool = createSaveQuestionTool(data, () => SEASONS_OFF, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ ...BASE_ARGS, category: "Science", slot: undefined }, SESSION),
    );
    assert.equal(parsed.saved, true);
  });
});

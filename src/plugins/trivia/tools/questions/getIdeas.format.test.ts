import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaConfig, TriviaGame } from "../../core/configTypes.js";
import type { SeasonEntry } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function makeConfig(trivia: TriviaConfig): TriviaConfig {
  return trivia;
}

const SEASONS_ON_CONFIG = makeConfig({
  seasons: { enabled: true, prompt: "Monthly" },
  answersFormat: { boolean: 1, choice: 0, freeform: 0 },
});

function makeSeason(overrides: Partial<SeasonEntry> = {}): SeasonEntry {
  const now = Date.now();
  return {
    slug: "active",
    startedAt: now - 10 * DAY,
    expectedEndAt: now + 20 * DAY,
    categories: ["Science", "History", "Geography", "Sports", "Art"],
    ...overrides,
  };
}

describe("get_ideas — format meta and slot routing", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Baseline-1", "Baseline-2"]);
  });

  it("returns format: null when active season has no format", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [makeSeason()],
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.format, null);
    assert.equal(parsed.slot, 0);
  });

  it("returns format meta when active season has format", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: {
            questions: [{ label: "Q1" }, { label: "History Choice", categories: ["History"] }],
          },
        }),
      ],
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

  it("surfaces flexible: true when the active season format is flexible", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: { questions: [{}, {}], flexible: true },
        }),
      ],
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
    );
    assert.equal(parsed.format.flexible, true);
    assert.equal(parsed.format.slotCount, 2);
  });

  it("omits flexible for a fixed format (payload unchanged)", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: { questions: [{}, {}] },
        }),
      ],
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
    );
    assert.equal(parsed.format.flexible, undefined);
  });

  it("surfaces flexible from a game format when no season format is active", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [makeSeason()],
    });
    const gameWithFlexibleFormat = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C100000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        format: { questions: [{}, {}, {}], flexible: true },
      },
    ];
    const tool = createGetIdeasTool(
      data,
      () => SEASONS_ON_CONFIG,
      () => gameWithFlexibleFormat,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
    );
    assert.equal(parsed.format.flexible, true);
    assert.equal(parsed.format.slotCount, 3);
  });

  it("masks a game's flexible flag when a fixed season format wins", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: { questions: [{}, {}] },
        }),
      ],
    });
    const gameWithFlexibleFormat = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C100000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        format: { questions: [{}], flexible: true },
      },
    ];
    const tool = createGetIdeasTool(
      data,
      () => SEASONS_ON_CONFIG,
      () => gameWithFlexibleFormat,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
    );
    assert.equal(parsed.format.slotCount, 2);
    assert.equal(parsed.format.flexible, undefined);
  });

  it("routes category pool through the slot's resolved categories", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: {
            questions: [{}, { categories: ["History"] }],
          },
        }),
      ],
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
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: { questions: [{}, {}] },
        }),
      ],
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 5 }, SESSION),
    );
    assert.match(parsed.error, /out of range/);
  });

  it("rejects non-zero slot when season has no format", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [makeSeason()],
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 1 }, SESSION),
    );
    assert.match(parsed.error, /no active format/);
  });

  it("accepts slot 0 when season has no format (backward compat)", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [makeSeason()],
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
    );
    assert.equal(parsed.slot, 0);
    assert.ok(parsed.categories);
  });

  it("uses slot.answersFormat when set (overrides season answersFormat)", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          answersFormat: { boolean: 1, choice: 0, freeform: 0 },
          format: {
            questions: [{ answersFormat: { boolean: 0, choice: 1, freeform: 0 } }],
          },
        }),
      ],
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

  it("uses a GAME-format slot's answersFormat when no season format is active", async () => {
    // The intended behavior change: game-format slot overrides now resolve (previously
    // dropped because get_ideas read the slot tier from the season format only).
    const gameWithFormat: TriviaGame = {
      name: FIXTURE_GAME_NAME,
      channel: "C100000000",
      questionCron: "0 9 * * 1-5",
      revealCron: "0 17 * * 1-5",
      timezone: "UTC",
      answersFormat: { boolean: 1, choice: 0, freeform: 0 }, // game default = boolean
      format: { questions: [{ answersFormat: { boolean: 0, choice: 1, freeform: 0 } }] }, // slot 0 = choice
    };
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 0, freeform: 0 } });
    const tool = createGetIdeasTool(
      data,
      () => cfg,
      () => [gameWithFormat],
    );
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedAnswersFormat, "choice", `iteration ${i}`);
    }
  });

  it("falls back to season.answersFormat when slot has none", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          answersFormat: { boolean: 0, choice: 1, freeform: 0 },
          format: { questions: [{}] },
        }),
      ],
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
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: { questions: [{}] },
        }),
      ],
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
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: { questions: [{}, {}, {}] },
        }),
      ],
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
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: { questions: [{ label: "A" }, { label: "B" }] },
        }),
      ],
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const a = parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION));
    const b = parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME, slot: 1 }, SESSION));
    assert.deepEqual(a.format, b.format);
  });

  it("game.format is used when season has no format", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [makeSeason()],
    });
    const gameWithFormat = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C100000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        format: { questions: [{ label: "Daily" }, { label: "Bonus" }] },
      },
    ];
    const tool = createGetIdeasTool(
      data,
      () => SEASONS_ON_CONFIG,
      () => gameWithFormat,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 1 }, SESSION),
    );
    assert.equal(parsed.format.slotCount, 2);
    assert.equal(parsed.format.slots[1].label, "Bonus");
    assert.equal(parsed.slot, 1);
  });

  it("season.format wins over game.format", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: {
            questions: [{ label: "Season-A" }, { label: "Season-B" }, { label: "Season-C" }],
          },
        }),
      ],
    });
    const gameWithFormat = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C100000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        format: { questions: [{ label: "Game-A" }] },
      },
    ];
    const tool = createGetIdeasTool(
      data,
      () => SEASONS_ON_CONFIG,
      () => gameWithFormat,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
    );
    assert.equal(parsed.format.slotCount, 3);
    assert.equal(parsed.format.slots[0].label, "Season-A");
  });

  it("game.theme surfaced when no season theme is set", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [makeSeason()],
    });
    const gameWithTheme = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C100000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        theme: "Channel Lore Trivia",
      },
    ];
    const tool = createGetIdeasTool(
      data,
      () => SEASONS_ON_CONFIG,
      () => gameWithTheme,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.theme, "Channel Lore Trivia");
  });

  it("season.theme wins over game.theme", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [makeSeason({ theme: "Halloween" })],
    });
    const gameWithTheme = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C100000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        theme: "Channel Lore Trivia",
      },
    ];
    const tool = createGetIdeasTool(
      data,
      () => SEASONS_ON_CONFIG,
      () => gameWithTheme,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.theme, "Halloween");
  });
});

describe("get_ideas — suggestedFreeformAnswerShape (freeform branch)", () => {
  let data: FakeTriviaDataLayer;
  const FREEFORM_CONFIG = makeConfig({
    seasons: { enabled: true, prompt: "Monthly" },
    answersFormat: { boolean: 0, choice: 0, freeform: 1 },
  });

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Baseline-1", "Baseline-2"]);
  });

  it("is omitted on boolean / choice branches", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [makeSeason()],
    });
    const tool = createGetIdeasTool(data, () => SEASONS_ON_CONFIG, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedAnswersFormat, "boolean");
    assert.equal(parsed.suggestedFreeformAnswerShape, undefined);
  });

  it("rolls one of the legal shapes on freeform with uniform default", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [makeSeason()],
    });
    const tool = createGetIdeasTool(data, () => FREEFORM_CONFIG, fixtureGetGames);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      assert.equal(parsed.suggestedAnswersFormat, "freeform");
      assert.ok(
        ["name", "place", "phrase", "title", "date", "countable", "other"].includes(
          parsed.suggestedFreeformAnswerShape,
        ),
        `unexpected shape: ${parsed.suggestedFreeformAnswerShape}`,
      );
      seen.add(parsed.suggestedFreeformAnswerShape);
    }
    assert.ok(seen.size > 1, `uniform default should hit multiple shapes — only saw ${[...seen]}`);
  });

  it("honors slot.freeformAnswerShape (overrides season + config)", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          freeformAnswerShape: {
            name: 0,
            place: 0,
            phrase: 0,
            title: 0,
            date: 1,
            countable: 0,
            other: 0,
          },
          format: {
            questions: [
              {
                freeformAnswerShape: {
                  name: 1,
                  place: 0,
                  phrase: 0,
                  title: 0,
                  date: 0,
                  countable: 0,
                  other: 0,
                },
              },
            ],
          },
        }),
      ],
    });
    const tool = createGetIdeasTool(data, () => FREEFORM_CONFIG, fixtureGetGames);
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedFreeformAnswerShape, "name", `iteration ${i}`);
    }
  });

  it("falls back to season.freeformAnswerShape when slot has none", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          freeformAnswerShape: {
            name: 0,
            place: 1,
            phrase: 0,
            title: 0,
            date: 0,
            countable: 0,
            other: 0,
          },
          format: { questions: [{}] },
        }),
      ],
    });
    const tool = createGetIdeasTool(data, () => FREEFORM_CONFIG, fixtureGetGames);
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedFreeformAnswerShape, "place", `iteration ${i}`);
    }
  });

  it("falls back to config.trivia.freeformAnswerShape when neither slot nor season has it", async () => {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        makeSeason({
          format: { questions: [{}] },
        }),
      ],
    });
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "Monthly" },
      answersFormat: { boolean: 0, choice: 0, freeform: 1 },
      freeformAnswerShape: {
        name: 0,
        place: 0,
        phrase: 1,
        title: 0,
        date: 0,
        countable: 0,
        other: 0,
      },
    });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
      );
      assert.equal(parsed.suggestedFreeformAnswerShape, "phrase", `iteration ${i}`);
    }
  });
});

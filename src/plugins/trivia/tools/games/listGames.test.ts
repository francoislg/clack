import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { fixtureGetGames, FIXTURE_GAME_NAME, FIXTURE_GAMES } from "../../testHelpers.js";
import { createListGamesTool } from "./listGames.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaConfig, TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

function emptyTriviaConfig(): TriviaConfig {
  return {};
}

describe("list_games — per-game entries", () => {
  it("surfaces questionCron, revealCron, timezone, channel, enabled per game", async () => {
    const tool = createListGamesTool(fixtureGetGames, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.equal(parsed.total, 1);
    const main = parsed.games[0];
    assert.equal(main.name, FIXTURE_GAME_NAME);
    assert.equal(main.channel, "C100000000");
    assert.equal(main.timezone, "UTC");
    assert.equal(main.enabled, true);
    assert.equal(main.questionCron, "0 9 * * 1-5");
    assert.equal(main.revealCron, "0 17 * * 1-5");
  });

  it("surfaces per-game format / categories / theme when set", async () => {
    const games: readonly TriviaGame[] = [
      {
        name: "themed",
        channel: "C200000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        format: { questions: [{ label: "Daily" }] },
        categories: ["History", "Science"],
        theme: "Channel Lore Trivia",
      },
    ];
    const tool = createListGamesTool(() => games, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    const entry = parsed.games[0];
    assert.deepEqual(entry.format, { questions: [{ label: "Daily" }] });
    assert.deepEqual(entry.categories, ["History", "Science"]);
    assert.equal(entry.theme, "Channel Lore Trivia");
  });

  it("omits per-game format / categories / theme when not set", async () => {
    const tool = createListGamesTool(fixtureGetGames, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    const entry = parsed.games[0];
    assert.equal("format" in entry, false);
    assert.equal("categories" in entry, false);
    assert.equal("theme" in entry, false);
  });

  it("surfaces per-game allTimeRow when set, omits it when absent", async () => {
    const games: readonly TriviaGame[] = [
      {
        name: "always-on",
        channel: "C300000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        allTimeRow: "always",
      },
    ];
    const withValue = parseToolResult(
      await createListGamesTool(() => games, emptyTriviaConfig).handler(
        { includeDisabled: undefined },
        SESSION,
      ),
    );
    assert.equal(withValue.games[0].allTimeRow, "always");

    const without = parseToolResult(
      await createListGamesTool(fixtureGetGames, emptyTriviaConfig).handler(
        { includeDisabled: undefined },
        SESSION,
      ),
    );
    assert.equal("allTimeRow" in without.games[0], false);
  });

  it("surfaces prepCron and nextPrepFire when set", async () => {
    const games: readonly TriviaGame[] = [
      {
        name: "prep-enabled",
        channel: "C200000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        prepCron: "30 8 * * 1-5",
        timezone: "UTC",
        enabled: true,
      },
    ];
    const tool = createListGamesTool(() => games, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    const entry = parsed.games[0];
    assert.equal(entry.prepCron, "30 8 * * 1-5");
    assert.equal(typeof entry.nextPrepFire, "number");
    assert.ok(entry.nextPrepFire > Date.now() - 86_400_000); // at most a day in the past (safety)
  });

  it("omits prepCron and nextPrepFire when not set (existing games unaffected)", async () => {
    const tool = createListGamesTool(fixtureGetGames, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    const entry = parsed.games[0];
    assert.equal("prepCron" in entry, false);
    assert.equal("nextPrepFire" in entry, false);
  });

  it("excludes disabled games by default, surfaces them with includeDisabled: true", async () => {
    const games: readonly TriviaGame[] = [
      ...FIXTURE_GAMES,
      {
        name: "retired",
        channel: "C999",
        questionCron: "0 0 * * *",
        revealCron: "0 1 * * *",
        timezone: "UTC",
        enabled: false,
      },
    ];
    const tool = createListGamesTool(() => games, emptyTriviaConfig);

    const filtered = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.equal(filtered.total, 1);
    assert.equal(filtered.games[0].name, "main");

    const all = parseToolResult(await tool.handler({ includeDisabled: true }, SESSION));
    assert.equal(all.total, 2);
    const names = all.games.map((g: { name: string }) => g.name).sort();
    assert.deepEqual(names, ["main", "retired"]);
  });
});

describe("list_games — workspaceDefaults block", () => {
  it("returns empty workspaceDefaults when config.trivia has no axis overrides", async () => {
    const tool = createListGamesTool(fixtureGetGames, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.ok(parsed.workspaceDefaults !== undefined, "workspaceDefaults key must be present");
    assert.deepEqual(parsed.workspaceDefaults, {});
  });

  it("surfaces every workspace axis that is explicitly set; omits the rest", async () => {
    const cfg: TriviaConfig = {
      answersFormat: { boolean: 2, choice: 1, freeform: 0 },
      freeformAnswerShape: {
        name: 3,
        place: 1,
        phrase: 1,
        title: 1,
        date: 0,
        countable: 0,
        other: 1,
      },
      seasons: { enabled: true, prompt: "Monthly" },
    };
    const tool = createListGamesTool(fixtureGetGames, () => cfg);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.deepEqual(parsed.workspaceDefaults.answersFormat, cfg.answersFormat);
    assert.deepEqual(parsed.workspaceDefaults.freeformAnswerShape, cfg.freeformAnswerShape);
    assert.deepEqual(parsed.workspaceDefaults.seasons, cfg.seasons);
    assert.equal("questionType" in parsed.workspaceDefaults, false);
    assert.equal("contexts" in parsed.workspaceDefaults, false);
    assert.equal("difficulty" in parsed.workspaceDefaults, false);
    assert.equal("offDays" in parsed.workspaceDefaults, false);
    assert.equal("choices" in parsed.workspaceDefaults, false);
  });

  it("surfaces offDays + choices when set on the workspace", async () => {
    const cfg: TriviaConfig = {
      choices: { min: 3, max: 4 },
      offDays: [{ date: "12-25", label: "Christmas" }],
    };
    const tool = createListGamesTool(fixtureGetGames, () => cfg);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.deepEqual(parsed.workspaceDefaults.choices, cfg.choices);
    assert.deepEqual(parsed.workspaceDefaults.offDays, cfg.offDays);
  });

  it("surfaces workspaceDefaults.allTimeRow only when set", async () => {
    const withValue = parseToolResult(
      await createListGamesTool(fixtureGetGames, () => ({ allTimeRow: "always" })).handler(
        { includeDisabled: undefined },
        SESSION,
      ),
    );
    assert.equal(withValue.workspaceDefaults.allTimeRow, "always");

    const without = parseToolResult(
      await createListGamesTool(fixtureGetGames, emptyTriviaConfig).handler(
        { includeDisabled: undefined },
        SESSION,
      ),
    );
    assert.equal("allTimeRow" in without.workspaceDefaults, false);
  });

  it("workspaceDefaults is always present even on an empty games list", async () => {
    const cfg: TriviaConfig = {
      questionType: { fact: 1, topical: 1 },
    };
    const tool = createListGamesTool(
      () => [],
      () => cfg,
    );
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.equal(parsed.total, 0);
    assert.deepEqual(parsed.games, []);
    assert.deepEqual(parsed.workspaceDefaults.questionType, cfg.questionType);
  });
});

describe("list_games — per-game axisOverrides", () => {
  const baseGame = {
    name: "main",
    channel: "C100000000",
    questionCron: "0 9 * * 1-5",
    revealCron: "0 17 * * 1-5",
    timezone: "UTC",
    enabled: true,
  } as const;

  it("emits axisOverrides:{} when the game has no per-game fields set", async () => {
    const tool = createListGamesTool(
      () => [baseGame],
      () => ({}),
    );
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.deepEqual(parsed.games[0].axisOverrides, {});
  });

  it("surfaces each axis field that is set on the game entry", async () => {
    const games: readonly TriviaGame[] = [
      {
        ...baseGame,
        answersFormat: { boolean: 0, choice: 1, freeform: 0 },
        contexts: [{ name: "Quebec", weight: 3 }],
      },
    ];
    const tool = createListGamesTool(
      () => games,
      () => ({}),
    );
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    const entry = parsed.games[0];
    assert.deepEqual(entry.axisOverrides.answersFormat, { boolean: 0, choice: 1, freeform: 0 });
    assert.deepEqual(entry.axisOverrides.contexts, [{ name: "Quebec", weight: 3 }]);
    assert.equal(entry.axisOverrides.questionType, undefined);
    assert.equal(entry.axisOverrides.freeformAnswerShape, undefined);
    assert.equal(entry.axisOverrides.difficulty, undefined);
  });

  it("description references the four-tier cascade", () => {
    const tool = createListGamesTool(
      () => [],
      () => ({}),
    );
    assert.match(tool.description, /slot.*season.*game.*workspace/);
  });

  it("description references the trivia:management integration", () => {
    const tool = createListGamesTool(
      () => [],
      () => ({}),
    );
    assert.match(tool.description, /trivia:management/);
  });
});

describe("list_games — instructions and additionalInstructions surfaces", () => {
  it("present-iff-set on per-game entries", async () => {
    const games: readonly TriviaGame[] = [
      {
        name: "with-both",
        channel: "C200000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        instructions: "Be dry.",
        additionalInstructions: "Avoid politics.",
      },
      {
        name: "with-neither",
        channel: "C300000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
      },
    ];
    const tool = createListGamesTool(() => games, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    const withBoth = parsed.games.find((g: { name: string }) => g.name === "with-both");
    const withNeither = parsed.games.find((g: { name: string }) => g.name === "with-neither");
    assert.equal(withBoth.instructions, "Be dry.");
    assert.equal(withBoth.additionalInstructions, "Avoid politics.");
    assert.equal(withNeither.instructions, undefined);
    assert.equal(withNeither.additionalInstructions, undefined);
  });

  it("surfaces workspace-tier values on workspaceDefaults", async () => {
    const cfg: TriviaConfig = {
      instructions: "Workspace baseline.",
      additionalInstructions: "Workspace stack.",
    };
    const tool = createListGamesTool(
      () => FIXTURE_GAMES,
      () => cfg,
    );
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.equal(parsed.workspaceDefaults.instructions, "Workspace baseline.");
    assert.equal(parsed.workspaceDefaults.additionalInstructions, "Workspace stack.");
  });
});

describe("list_games — cron job UUID surfacing", () => {
  const twoSlotGame: TriviaGame = {
    name: "daily",
    channel: "C100000000",
    questionCron: "0 9 * * 1-5",
    revealCron: "0 17 * * 1-5",
    timezone: "UTC",
    enabled: true,
  };
  const threeSlotGame: TriviaGame = {
    name: "daily",
    channel: "C100000000",
    questionCron: "0 9 * * 1-5",
    revealCron: "0 17 * * 1-5",
    prepCron: "45 8 * * 1-5",
    timezone: "UTC",
    enabled: true,
  };

  it("surfaces questionJobId and revealJobId when reconcile registered them", async () => {
    const tool = createListGamesTool(
      () => [twoSlotGame],
      emptyTriviaConfig,
      async () => [
        { id: "job-q-uuid", specKey: "daily:question" },
        { id: "job-r-uuid", specKey: "daily:reveal" },
      ],
    );
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    const entry = parsed.games[0];
    assert.equal(entry.questionJobId, "job-q-uuid");
    assert.equal(entry.revealJobId, "job-r-uuid");
    assert.equal("prepJobId" in entry, false);
  });

  it("surfaces prepJobId when prepCron is set and the prep job is registered", async () => {
    const tool = createListGamesTool(
      () => [threeSlotGame],
      emptyTriviaConfig,
      async () => [
        { id: "job-q-uuid", specKey: "daily:question" },
        { id: "job-r-uuid", specKey: "daily:reveal" },
        { id: "job-p-uuid", specKey: "daily:prep" },
      ],
    );
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    const entry = parsed.games[0];
    assert.equal(entry.questionJobId, "job-q-uuid");
    assert.equal(entry.revealJobId, "job-r-uuid");
    assert.equal(entry.prepJobId, "job-p-uuid");
  });

  it("omits all job IDs when reconcile has not yet registered jobs", async () => {
    const tool = createListGamesTool(
      () => [twoSlotGame],
      emptyTriviaConfig,
      async () => [],
    );
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    const entry = parsed.games[0];
    assert.equal("questionJobId" in entry, false);
    assert.equal("revealJobId" in entry, false);
    assert.equal("prepJobId" in entry, false);
  });

  it("disabled-but-registered games surface IDs when includeDisabled: true", async () => {
    const retired: TriviaGame = { ...twoSlotGame, name: "retired", enabled: false };
    const tool = createListGamesTool(
      () => [retired],
      emptyTriviaConfig,
      async () => [
        { id: "job-q-uuid", specKey: "retired:question" },
        { id: "job-r-uuid", specKey: "retired:reveal" },
      ],
    );
    const parsed = parseToolResult(await tool.handler({ includeDisabled: true }, SESSION));
    const entry = parsed.games[0];
    assert.equal(entry.name, "retired");
    assert.equal(entry.questionJobId, "job-q-uuid");
    assert.equal(entry.revealJobId, "job-r-uuid");
  });
});

describe("list_games — hint surfacing", () => {
  it("surfaces workspace `hint` when set", async () => {
    const triviaConfig = (): TriviaConfig => ({
      hint: { mode: "button", minDifficulty: "medium" },
    });
    const tool = createListGamesTool(fixtureGetGames, triviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.deepEqual(parsed.workspaceDefaults.hint, { mode: "button", minDifficulty: "medium" });
  });

  it("omits workspace `hint` when not set", async () => {
    const tool = createListGamesTool(fixtureGetGames, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.equal(parsed.workspaceDefaults.hint, undefined);
  });

  it("surfaces per-game `hint` when set", async () => {
    const games: readonly TriviaGame[] = [
      {
        name: "with-hint",
        channel: "C200000000",
        questionCron: "0 9 * * 1-5",
        revealCron: "0 17 * * 1-5",
        timezone: "UTC",
        enabled: true,
        hint: { mode: "inline" },
      },
    ];
    const tool = createListGamesTool(() => games, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.deepEqual(parsed.games[0].hint, { mode: "inline" });
  });

  it("omits per-game `hint` when not set", async () => {
    const tool = createListGamesTool(fixtureGetGames, emptyTriviaConfig);
    const parsed = parseToolResult(await tool.handler({ includeDisabled: undefined }, SESSION));
    assert.equal(parsed.games[0].hint, undefined);
  });
});

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createUpsertGameTool } from "./upsertGame.js";
import { _resetTriviaConfigBridge, loadTriviaConfig } from "../../core/configBridge.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import { createTriviaDataLayer } from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import type { TriviaConfig, TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

const baseGame: TriviaGame = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 17 * * 1-5",
  timezone: "America/Montreal",
  enabled: true,
};

/**
 * Tool handlers are fully typed, so every field has to be present on every
 * call (zod treats missing keys as undefined, but TS doesn't). This helper
 * defaults every field to `undefined` so individual tests only spell out what
 * they're actually exercising — keeps the assertions readable and means
 * adding new optional fields to the tool doesn't ripple into every call site.
 */
type UpsertGameArgs = Parameters<ReturnType<typeof createUpsertGameTool>["handler"]>[0];

function args(overrides: Partial<UpsertGameArgs> & Pick<UpsertGameArgs, "name">): UpsertGameArgs {
  return {
    channel: undefined,
    questionCron: undefined,
    revealCron: undefined,
    prepCron: undefined,
    lockCron: undefined,
    timezone: undefined,
    enabled: undefined,
    answersFormat: undefined,
    questionType: undefined,
    freeformAnswerShape: undefined,
    contexts: undefined,
    difficulty: undefined,
    difficultyRatio: undefined,
    format: undefined,
    categories: undefined,
    theme: undefined,
    liveAnswersVisible: undefined,
    revealResponses: undefined,
    instructions: undefined,
    additionalInstructions: undefined,
    hint: undefined,
    allTimeRow: undefined,
    tagPlayers: undefined,
    scrollToTop: undefined,
    disableAfterRound: undefined,
    includeRevealInQuestions: undefined,
    finalRevealSummary: undefined,
    judgeLeniency: undefined,
    choiceEmojiStyle: undefined,
    points: undefined,
    tellMeMore: undefined,
    choices: undefined,
    teams: undefined,
    teamsEnabled: undefined,
    teamsFinaleIndividuals: undefined,
    teamsScoring: undefined,
    answeringType: undefined,
    perfectRoundsAward: undefined,
    initialSeason: undefined,
    ...overrides,
  };
}

describe("upsert_game — create branch", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("creates a new game with all required fields", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C999",
          questionCron: "0 9 * * 1-5",
          revealCron: "0 17 * * 1-5",
          timezone: "UTC",
        }),
        SESSION,
      ),
    );
    assert.equal(result.action, "created");
    assert.equal(result.name, "engineering");
    assert.equal(result.enabled, true);
    assert.equal(result.hasAxisOverrides, false);
    assert.equal(result.hasStructuralOverrides, false);

    const next = loadTriviaConfig();
    assert.equal(next?.games?.length, 1);
    assert.equal(next?.games?.[0]?.name, "engineering");
  });

  it("creates a game with per-game axis overrides", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          answersFormat: { boolean: 0, choice: 1 },
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasAxisOverrides, true);
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.answersFormat, { boolean: 0, choice: 1, freeform: 0 });
  });

  it("persists tellMeMore on the game (and reports hasTellMeMore)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          tellMeMore: { enabled: true },
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasTellMeMore, true);
    assert.deepEqual(loadTriviaConfig()?.games?.[0]?.tellMeMore, { enabled: true });
  });

  it("clears tellMeMore on update when passed null", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [{ ...baseGame, tellMeMore: { enabled: true } }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", tellMeMore: null }), SESSION);
    assert.equal(loadTriviaConfig()?.games?.[0]?.tellMeMore, undefined);
  });

  it("persists includeRevealInQuestions and clears it on null", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          includeRevealInQuestions: "yes",
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasIncludeRevealInQuestions, true);
    assert.equal(loadTriviaConfig()?.games?.[0]?.includeRevealInQuestions, "yes");

    await tool.handler(args({ name: "engineering", includeRevealInQuestions: null }), SESSION);
    assert.equal(loadTriviaConfig()?.games?.[0]?.includeRevealInQuestions, undefined);
  });

  it("persists tagPlayers and clears it on null", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          tagPlayers: false,
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasTagPlayers, true);
    assert.equal(loadTriviaConfig()?.games?.[0]?.tagPlayers, false);

    await tool.handler(args({ name: "engineering", tagPlayers: null }), SESSION);
    assert.equal(loadTriviaConfig()?.games?.[0]?.tagPlayers, undefined);
    assert.equal("tagPlayers" in (loadTriviaConfig()?.games?.[0] ?? {}), false);
  });

  it("persists disableAfterRound, keeps it on omit, and clears it on null", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          disableAfterRound: true,
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasDisableAfterRound, true);
    assert.equal(loadTriviaConfig()?.games?.[0]?.disableAfterRound, true);

    await tool.handler(args({ name: "engineering", theme: "space" }), SESSION);
    assert.equal(loadTriviaConfig()?.games?.[0]?.disableAfterRound, true, "omit keeps the flag");

    await tool.handler(args({ name: "engineering", disableAfterRound: null }), SESSION);
    assert.equal(loadTriviaConfig()?.games?.[0]?.disableAfterRound, undefined);
    assert.equal("disableAfterRound" in (loadTriviaConfig()?.games?.[0] ?? {}), false);
  });

  it("persists finalRevealSummary and clears it on null", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          finalRevealSummary: "in-thread",
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasFinalRevealSummary, true);
    assert.equal(loadTriviaConfig()?.games?.[0]?.finalRevealSummary, "in-thread");

    await tool.handler(args({ name: "engineering", finalRevealSummary: null }), SESSION);
    assert.equal(loadTriviaConfig()?.games?.[0]?.finalRevealSummary, undefined);
  });

  it("rejects create when scheduling fields are missing", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(args({ name: "incomplete", channel: "C1" }), SESSION),
    );
    assert.match(result.error, /Creating a new game requires/);
  });

  it("rejects invalid cron expression", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "badcron",
          channel: "C1",
          questionCron: "not a cron",
          revealCron: "0 17 * * *",
          timezone: "UTC",
        }),
        SESSION,
      ),
    );
    assert.match(result.error, /Invalid questionCron/);
  });

  it("rejects invalid name format", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "Bad Name!",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
        }),
        SESSION,
      ),
    );
    assert.match(result.error, /Invalid game name/);
  });

  it("rejects invalid axis value (all-zero answersFormat)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "test",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          answersFormat: { boolean: 0, choice: 0 },
        }),
        SESSION,
      ),
    );
    assert.match(result.error, /at least one strictly positive weight/);
  });

  it("creates a game with format / categories / theme structural overrides", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          format: { questions: [{ label: "Warm-up" }, { label: "Main" }] },
          categories: ["Engineering", "Coding"],
          theme: "Engineering deep-dives",
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasStructuralOverrides, true);
    assert.equal(result.hasFormat, true);
    assert.equal(result.hasCategories, true);
    assert.equal(result.hasTheme, true);
    assert.equal(result.slotCount, 2);

    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.format?.questions.length, 2);
    assert.deepEqual(game?.categories, ["Engineering", "Coding"]);
    assert.equal(game?.theme, "Engineering deep-dives");
  });

  it("dedupes and trims categories on create", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(
      args({
        name: "engineering",
        channel: "C1",
        questionCron: "0 9 * * *",
        revealCron: "0 17 * * *",
        timezone: "UTC",
        categories: ["  Science  ", "Science", "Coding", ""],
      }),
      SESSION,
    );
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.categories, ["Science", "Coding"]);
  });

  it("rejects empty categories array", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          categories: ["", "   "],
        }),
        SESSION,
      ),
    );
    assert.match(result.error, /categories must contain at least one non-empty string/);
  });

  it("rejects empty / whitespace-only theme", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          theme: "   ",
        }),
        SESSION,
      ),
    );
    assert.match(result.error, /theme must be non-empty/);
  });

  it("rejects invalid format (empty questions array)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          format: { questions: [] },
        }),
        SESSION,
      ),
    );
    assert.match(result.error, /questions.*non-empty array/);
  });
});

describe("upsert_game — update branch", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("updates a single scheduling field, preserves the rest", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(args({ name: "main", questionCron: "0 10 * * *" }), SESSION),
    );
    assert.equal(result.action, "updated");
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.questionCron, "0 10 * * *");
    assert.equal(game?.revealCron, baseGame.revealCron);
    assert.equal(game?.channel, baseGame.channel);
  });

  it("sets a per-game axis override on existing game", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", answersFormat: { boolean: 1, choice: 1 } }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.answersFormat, { boolean: 1, choice: 1, freeform: 0 });
  });

  it("clears an axis override with explicit null", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [{ ...baseGame, answersFormat: { boolean: 1, choice: 1, freeform: 0 } }],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", answersFormat: null }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.answersFormat, undefined);
  });

  it("omit-to-keep preserves untouched axis overrides", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [
        {
          ...baseGame,
          answersFormat: { boolean: 1, choice: 1, freeform: 0 },
          questionType: { fact: 1, topical: 0, prediction: 0 },
        },
      ],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", questionType: { fact: 0, topical: 1 } }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.answersFormat, { boolean: 1, choice: 1, freeform: 0 });
    assert.deepEqual(game?.questionType, { fact: 0, topical: 1, prediction: 0 });
  });

  it("toggles enabled to false", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", enabled: false }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.enabled, false);
  });

  it("sets format / categories / theme on existing game", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(
      args({
        name: "main",
        format: { questions: [{ label: "A" }, { label: "B" }, { label: "C" }] },
        categories: ["Sports", "History"],
        theme: "Vintage trivia",
      }),
      SESSION,
    );
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.format?.questions.length, 3);
    assert.deepEqual(game?.categories, ["Sports", "History"]);
    assert.equal(game?.theme, "Vintage trivia");
  });

  it("clears structural fields with explicit null", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [
        {
          ...baseGame,
          format: { questions: [{ label: "x" }] },
          categories: ["Science"],
          theme: "Originally themed",
        },
      ],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(
      args({ name: "main", format: null, categories: null, theme: null }),
      SESSION,
    );
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.format, undefined);
    assert.equal(game?.categories, undefined);
    assert.equal(game?.theme, undefined);
  });

  it("omit-to-keep preserves untouched structural fields", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [
        {
          ...baseGame,
          format: { questions: [{ label: "x" }] },
          categories: ["Science"],
          theme: "Stays put",
        },
      ],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", theme: "Replaced" }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.format?.questions.length, 1);
    assert.deepEqual(game?.categories, ["Science"]);
    assert.equal(game?.theme, "Replaced");
  });

  it("accepts freeformAnswerShape with countable key (post-rename)", async () => {
    // Regression test for ef53bab: the schema renamed `number` → `countable`.
    // Verifies the upsert_game tool path accepts the new key end-to-end.
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(
      args({
        name: "main",
        freeformAnswerShape: { name: 1, countable: 2 },
      }),
      SESSION,
    );
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.freeformAnswerShape?.name, 1);
    assert.equal(game?.freeformAnswerShape?.countable, 2);
  });
});

describe("upsert_game — instructions and additionalInstructions", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("create persists both fields and surfaces hasInstructions / hasAdditionalInstructions", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "main",
          channel: "C123",
          questionCron: "0 9 * * 1-5",
          revealCron: "0 17 * * 1-5",
          timezone: "America/Montreal",
          instructions: "  Be dry.  ",
          additionalInstructions: "Avoid politics.",
        }),
        SESSION,
      ),
    );
    assert.equal(result.action, "created");
    assert.equal(result.hasInstructions, true);
    assert.equal(result.hasAdditionalInstructions, true);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.instructions, "Be dry.");
    assert.equal(game?.additionalInstructions, "Avoid politics.");
  });

  it("update with null clears the named field but preserves the other", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [{ ...baseGame, instructions: "Be dry.", additionalInstructions: "Avoid politics." }],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", instructions: null }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.instructions, undefined);
    assert.equal(game?.additionalInstructions, "Avoid politics.");
  });

  it("update with omitted fields preserves both existing values", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [{ ...baseGame, instructions: "Be dry.", additionalInstructions: "Avoid politics." }],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", enabled: false }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.instructions, "Be dry.");
    assert.equal(game?.additionalInstructions, "Avoid politics.");
    assert.equal(game?.enabled, false);
  });

  it("rejects empty / whitespace-only strings", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [{ ...baseGame }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(args({ name: "main", instructions: "   " }), SESSION),
    );
    assert.match(result.error ?? "", /instructions.*non-empty/);
  });

  it("hasInstructions / hasAdditionalInstructions reflect mid-cascade state", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [{ ...baseGame, instructions: "Be dry." }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(args({ name: "main", additionalInstructions: "Stack me." }), SESSION),
    );
    assert.equal(result.action, "updated");
    assert.equal(result.hasInstructions, true);
    assert.equal(result.hasAdditionalInstructions, true);
  });
});

describe("upsert_game — prepCron", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("creates a game with prepCron", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "main",
          channel: "C123",
          questionCron: "0 9 * * 1-5",
          revealCron: "0 17 * * 1-5",
          prepCron: "30 8 * * 1-5",
          timezone: "America/Montreal",
        }),
        SESSION,
      ),
    );
    assert.equal(result.action, "created");
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.prepCron, "30 8 * * 1-5");
  });

  it("adds prepCron to an existing game (update branch)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [{ ...baseGame }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", prepCron: "30 8 * * 1-5" }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.prepCron, "30 8 * * 1-5");
    // Other fields preserved
    assert.equal(game?.questionCron, "0 9 * * 1-5");
    assert.equal(game?.revealCron, "0 17 * * 1-5");
  });

  it("omitting prepCron on update keeps the existing value", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [{ ...baseGame, prepCron: "30 8 * * 1-5" }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", enabled: false }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.prepCron, "30 8 * * 1-5");
    assert.equal(game?.enabled, false);
  });

  it("passing prepCron: null clears it (opt out of pre-staging)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [{ ...baseGame, prepCron: "30 8 * * 1-5" }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", prepCron: null }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.prepCron, undefined);
  });

  it("rejects invalid prepCron expression", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "main",
          channel: "C123",
          questionCron: "0 9 * * 1-5",
          revealCron: "0 17 * * 1-5",
          prepCron: "not a cron",
          timezone: "America/Montreal",
        }),
        SESSION,
      ),
    );
    assert.match(result.error ?? "", /Invalid prepCron/);
  });

  it("a game can be created without prepCron (it's optional)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "main",
          channel: "C123",
          questionCron: "0 9 * * 1-5",
          revealCron: "0 17 * * 1-5",
          timezone: "America/Montreal",
        }),
        SESSION,
      ),
    );
    assert.equal(result.action, "created");
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.prepCron, undefined);
  });
});

describe("upsert_game — judgeLeniency", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("creates a game carrying a judgeLeniency override", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "lenient-game",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          judgeLeniency: "lenient",
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasJudgeLeniency, true);
    assert.equal(loadTriviaConfig()?.games?.[0]?.judgeLeniency, "lenient");
  });

  it("updates and then clears judgeLeniency on an existing game", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [
        {
          name: "g",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: true,
          judgeLeniency: "strict",
        },
      ],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);

    await tool.handler(args({ name: "g", judgeLeniency: "lenient" }), SESSION);
    assert.equal(loadTriviaConfig()?.games?.[0]?.judgeLeniency, "lenient");

    const cleared = parseToolResult(
      await tool.handler(args({ name: "g", judgeLeniency: null }), SESSION),
    );
    assert.equal(cleared.hasJudgeLeniency, false);
    assert.equal(loadTriviaConfig()?.games?.[0]?.judgeLeniency, undefined);
  });
});

describe("upsert_game — choices", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("creates a game carrying a choices override", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "narrow-game",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          choices: { min: 2, max: 2 },
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasChoices, true);
    assert.deepEqual(loadTriviaConfig()?.games?.[0]?.choices, { min: 2, max: 2 });
  });

  it("rejects out-of-range bounds", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "bad-game",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          choices: { min: 1, max: 4 },
        }),
        SESSION,
      ),
    );
    assert.ok(result.error || result.isError);
  });

  it("updates and then clears choices on an existing game", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [
        {
          name: "g",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: true,
          choices: { min: 2, max: 2 },
        },
      ],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);

    await tool.handler(args({ name: "g", choices: { min: 3, max: 4 } }), SESSION);
    assert.deepEqual(loadTriviaConfig()?.games?.[0]?.choices, { min: 3, max: 4 });

    const cleared = parseToolResult(
      await tool.handler(args({ name: "g", choices: null }), SESSION),
    );
    assert.equal(cleared.hasChoices, false);
    assert.equal(loadTriviaConfig()?.games?.[0]?.choices, undefined);
  });
});

describe("upsert_game — points", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("creates a game carrying a points override", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "stakes-game",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          points: { max: 3, guidance: "hard questions pay 3" },
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasPoints, true);
    assert.deepEqual(loadTriviaConfig()?.games?.[0]?.points, {
      max: 3,
      guidance: "hard questions pay 3",
    });
  });

  it("accepts a bare cap — an allowance for admin reclassing, no guidance needed", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "allowance-game",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          points: { max: 3 },
        }),
        SESSION,
      ),
    );
    assert.equal(result.hasPoints, true);
    assert.deepEqual(loadTriviaConfig()?.games?.[0]?.points, { max: 3 });
  });

  it("rejects an out-of-range cap", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "bad-game",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          points: { max: 99 },
        }),
        SESSION,
      ),
    );
    assert.ok(result.error || result.isError);
  });

  it("updates and then clears points on an existing game", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [
        {
          name: "g",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: true,
          points: { max: 2, guidance: "old rule" },
        },
      ],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);

    await tool.handler(args({ name: "g", points: { max: 4 } }), SESSION);
    assert.deepEqual(
      loadTriviaConfig()?.games?.[0]?.points,
      { max: 4 },
      "whole-object replace — the old guidance does not survive",
    );

    const cleared = parseToolResult(await tool.handler(args({ name: "g", points: null }), SESSION));
    assert.equal(cleared.hasPoints, false);
    assert.equal(loadTriviaConfig()?.games?.[0]?.points, undefined);
  });
});

describe("upsert_game — shadowing detection", () => {
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("reports season shadowing of a written axis field", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const now = Date.now();
    await data.forGame("main").saveSeasonsState({
      seasons: [
        {
          slug: "active",
          startedAt: now - DAY,
          expectedEndAt: now + DAY,
          answersFormat: { boolean: 1, choice: 0, freeform: 0 },
        },
      ],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
    const result = parseToolResult(
      await tool.handler(
        args({ name: "main", answersFormat: { boolean: 0, choice: 1, freeform: 0 } }),
        SESSION,
      ),
    );
    assert.deepEqual(result.shadowedBy, {
      tier: "season",
      slug: "active",
      fields: ["answersFormat"],
    });
  });

  it("omits shadowedBy when no active season overrides the written field", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
    const result = parseToolResult(
      await tool.handler(
        args({ name: "main", answersFormat: { boolean: 0, choice: 1, freeform: 0 } }),
        SESSION,
      ),
    );
    assert.equal(result.shadowedBy, undefined);
  });
});

describe("upsert_game — initialSeason (seasons enabled)", () => {
  const seasonsOn: TriviaConfig = { games: [], seasons: { enabled: true, prompt: "p" } };

  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  function createArgs(extra: Partial<UpsertGameArgs> = {}): UpsertGameArgs {
    return args({
      name: "engineering",
      channel: "C1",
      questionCron: "0 9 * * *",
      revealCron: "0 17 * * *",
      timezone: "UTC",
      ...extra,
    });
  }

  it("rejects CREATE with no initialSeason and writes nothing", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, seasonsOn);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
    const result = parseToolResult(await tool.handler(createArgs(), SESSION));
    assert.match(result.error, /initialSeason/);
    assert.equal(loadTriviaConfig()?.games?.length, 0);
    const state = await data.forGame("engineering").loadSeasonsState();
    assert.ok(state?.seasons.length === 1, "seasons-enabled bootstrap creates default season");
  });

  it("writes the game and its first season atomically with only timeline fields", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, seasonsOn);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
    const startedAt = 1_000;
    const expectedEndAt = 9_000;
    const result = parseToolResult(
      await tool.handler(
        createArgs({ initialSeason: { slug: "kickoff-2026", startedAt, expectedEndAt } }),
        SESSION,
      ),
    );
    assert.equal(result.action, "created");
    assert.equal(loadTriviaConfig()?.games?.length, 1);
    const state = await data.forGame("engineering").loadSeasonsState();
    assert.deepEqual(state, { seasons: [{ slug: "kickoff-2026", startedAt, expectedEndAt }] });
  });

  it("defaults initialSeason.startedAt to creation time when omitted", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, seasonsOn);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
    const before = Date.now();
    const result = parseToolResult(
      await tool.handler(
        createArgs({ initialSeason: { slug: "kickoff-2026", expectedEndAt: before + 1_000_000 } }),
        SESSION,
      ),
    );
    const after = Date.now();
    assert.equal(result.action, "created");
    const entry = (await data.forGame("engineering").loadSeasonsState())?.seasons[0];
    assert.ok(entry !== undefined);
    assert.ok(entry.startedAt >= before && entry.startedAt <= after);
    assert.equal(await data.forGame("engineering").getCurrentSeasonSlug(), "kickoff-2026");
  });

  it("rejects initialSeason whose expectedEndAt is not after startedAt", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, seasonsOn);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
    const result = parseToolResult(
      await tool.handler(
        createArgs({
          initialSeason: { slug: "kickoff-2026", startedAt: 9_000, expectedEndAt: 1_000 },
        }),
        SESSION,
      ),
    );
    assert.match(result.error, /strictly less than expectedEndAt/);
    assert.equal(loadTriviaConfig()?.games?.length, 0);
  });

  it("rejects non-kebab-case initialSeason slugs and writes nothing", async () => {
    for (const bad of ["", "Kickoff 2026", "UPPER", "trailing-", "-leading", "doub--le"]) {
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, seasonsOn);
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
      const result = parseToolResult(
        await tool.handler(
          createArgs({ initialSeason: { slug: bad, expectedEndAt: 9_000 } }),
          SESSION,
        ),
      );
      assert.match(result.error, /kebab-case/, `slug ${JSON.stringify(bad)} should be rejected`);
      assert.equal(loadTriviaConfig()?.games?.length, 0);
    }
  });

  it("rejects initialSeason when seasons are disabled", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
    const result = parseToolResult(
      await tool.handler(
        createArgs({ initialSeason: { slug: "kickoff-2026", expectedEndAt: 9_000 } }),
        SESSION,
      ),
    );
    assert.match(result.error, /seasons are currently disabled/);
    assert.equal(loadTriviaConfig()?.games?.length, 0);
  });

  it("rejects initialSeason on UPDATE of an existing game", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame], seasons: { enabled: true, prompt: "p" } });
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
    const result = parseToolResult(
      await tool.handler(
        args({ name: "main", initialSeason: { slug: "kickoff-2026", expectedEndAt: 9_000 } }),
        SESSION,
      ),
    );
    assert.match(result.error, /upsert_season/);
    const state = await data.forGame("main").loadSeasonsState();
    assert.ok(state?.seasons.length === 1, "seasons-enabled bootstrap creates one default season");
  });
});

describe("upsert_game — teams fields", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  const ROSTER = [
    { name: "Red", userIds: ["U1", "U2"] },
    { name: "Blue", userIds: ["U3"] },
  ];

  it("sets the four teams fields on update and reports them", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "main",
          teams: ROSTER,
          teamsEnabled: true,
          teamsFinaleIndividuals: true,
          teamsScoring: "total-points",
        }),
        SESSION,
      ),
    );
    assert.equal(result.action, "updated");
    assert.equal(result.hasTeams, true);
    assert.equal(result.hasTeamsEnabled, true);
    assert.equal(result.hasTeamsFinaleIndividuals, true);
    assert.equal(result.hasTeamsScoring, true);
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.teams, ROSTER);
    assert.equal(game?.teamsEnabled, true);
    assert.equal(game?.teamsScoring, "total-points");
  });

  it("null clears one teams field without touching siblings", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [{ ...baseGame, teams: ROSTER, teamsEnabled: true, teamsScoring: "total-points" }],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(args({ name: "main", teamsEnabled: null }), SESSION),
    );
    assert.equal(result.hasTeamsEnabled, false);
    assert.equal(result.hasTeams, true);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.teamsEnabled, undefined);
    assert.deepEqual(game?.teams, ROSTER);
    assert.equal(game?.teamsScoring, "total-points");
  });

  it("omit keeps the existing teams fields", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [{ ...baseGame, teams: ROSTER, teamsEnabled: true }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", theme: "New" }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.teams, ROSTER);
    assert.equal(game?.teamsEnabled, true);
  });

  it("rejects an invalid roster (user in two teams) without writing", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        args({
          name: "main",
          teams: [
            { name: "Red", userIds: ["U1"] },
            { name: "Blue", userIds: ["U1"] },
          ],
        }),
        SESSION,
      ),
    );
    assert.match(result.error, /at most one team/);
    assert.equal(loadTriviaConfig()?.games?.[0].teams, undefined);
  });

  it("accepts teamsEnabled: true with no roster at this tier (valid staging)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(args({ name: "main", teamsEnabled: true }), SESSION),
    );
    assert.equal(result.action, "updated");
    assert.equal(loadTriviaConfig()?.games?.[0].teamsEnabled, true);
  });

  it("reports shadowedBy when the active season has its own roster", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame], seasons: { enabled: true, prompt: "p" } });
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const now = Date.now();
    await data.forGame("main").saveSeasonsState({
      seasons: [
        {
          slug: "s1",
          startedAt: now - 1000,
          expectedEndAt: now + 86_400_000,
          teams: [{ name: "Gold", userIds: ["U9"] }],
        },
      ],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? [], data);
    const result = parseToolResult(
      await tool.handler(args({ name: "main", teams: ROSTER }), SESSION),
    );
    assert.deepEqual(result.shadowedBy, { tier: "season", slug: "s1", fields: ["teams"] });
  });
});

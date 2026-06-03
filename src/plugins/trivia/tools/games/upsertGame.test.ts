import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createUpsertGameTool } from "./upsertGame.js";
import {
  _resetTriviaConfigBridge,
  _setTriviaConfigForTests,
  _setTriviaConfigSdkForTests,
  loadTriviaConfig,
} from "../../core/configBridge.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import { createInMemoryDataLayer } from "../../testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaConfig, TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

interface FakeSdkState {
  writes: Map<string, string>;
}

function makeFakeSdk(state: FakeSdkState): ClackSdk {
  return {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    capabilities: { crons: true },
    error: () => {},
    addInstruction: () => {},
    addTopicInstruction: () => {},
    registerTool: () => {},
    mcpServer: { fullName: "test", registerTool: () => {}, addTopicInstruction: () => {} },
    registerMcpServer: () => ({
      fullName: "test",
      registerTool: () => {},
      addTopicInstruction: () => {},
    }),
    readFile: async (path) => state.writes.get(path) ?? null,
    writeFile: async (path, content) => {
      state.writes.set(path, content);
    },
    watchFile: () => {
      throw new Error("watchFile not used in upsert_game tests");
    },
    reconcileCronJobs: async () => {},
    findOwnedCronJobs: async () => [],
    dmOwner: async () => ({ ok: true as const }),
    getSlackClient: () => null,
    sendMessage: async () => ({ ok: true as const, ts: "1", channel: "C" }),
    startThreadConversation: async () => {},
    registerAction: () => {},
    registerView: () => {},
    actionId: (key: string) => `plugin:test:${key}`,
    viewCallbackId: (key: string) => `plugin:test:${key}`,
    askClaude: async () => ({
      text: "",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    requestSoftRestart: () => {},
    registerDictionary: () => {},
    t: (key: string) => key,
  };
}

function primeBridge(initial: TriviaConfig | null): FakeSdkState {
  const state: FakeSdkState = { writes: new Map() };
  _resetTriviaConfigBridge();
  _setTriviaConfigSdkForTests(makeFakeSdk(state));
  _setTriviaConfigForTests(initial);
  return state;
}

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
    judgeLeniency: undefined,
    tellMeMore: undefined,
    ...overrides,
  };
}

describe("upsert_game — create branch", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("creates a new game with all required fields", async () => {
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [{ ...baseGame, tellMeMore: { enabled: true } }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", tellMeMore: null }), SESSION);
    assert.equal(loadTriviaConfig()?.games?.[0]?.tellMeMore, undefined);
  });

  it("rejects create when scheduling fields are missing", async () => {
    primeBridge({ games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(args({ name: "incomplete", channel: "C1" }), SESSION),
    );
    assert.match(result.error, /Creating a new game requires/);
  });

  it("rejects invalid cron expression", async () => {
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [baseGame] });
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
    primeBridge({ games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", answersFormat: { boolean: 1, choice: 1 } }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.answersFormat, { boolean: 1, choice: 1, freeform: 0 });
  });

  it("clears an axis override with explicit null", async () => {
    primeBridge({
      games: [{ ...baseGame, answersFormat: { boolean: 1, choice: 1, freeform: 0 } }],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", answersFormat: null }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.answersFormat, undefined);
  });

  it("omit-to-keep preserves untouched axis overrides", async () => {
    primeBridge({
      games: [
        {
          ...baseGame,
          answersFormat: { boolean: 1, choice: 1, freeform: 0 },
          questionType: { fact: 1, topical: 0 },
        },
      ],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", questionType: { fact: 0, topical: 1 } }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.answersFormat, { boolean: 1, choice: 1, freeform: 0 });
    assert.deepEqual(game?.questionType, { fact: 0, topical: 1 });
  });

  it("toggles enabled to false", async () => {
    primeBridge({ games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", enabled: false }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.enabled, false);
  });

  it("sets format / categories / theme on existing game", async () => {
    primeBridge({ games: [baseGame] });
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
    primeBridge({
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
    primeBridge({
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
    primeBridge({ games: [baseGame] });
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
    primeBridge({ games: [] });
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
    primeBridge({
      games: [{ ...baseGame, instructions: "Be dry.", additionalInstructions: "Avoid politics." }],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", instructions: null }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.instructions, undefined);
    assert.equal(game?.additionalInstructions, "Avoid politics.");
  });

  it("update with omitted fields preserves both existing values", async () => {
    primeBridge({
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
    primeBridge({ games: [{ ...baseGame }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(args({ name: "main", instructions: "   " }), SESSION),
    );
    assert.match(result.error ?? "", /instructions.*non-empty/);
  });

  it("hasInstructions / hasAdditionalInstructions reflect mid-cascade state", async () => {
    primeBridge({ games: [{ ...baseGame, instructions: "Be dry." }] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [{ ...baseGame }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", prepCron: "30 8 * * 1-5" }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.prepCron, "30 8 * * 1-5");
    // Other fields preserved
    assert.equal(game?.questionCron, "0 9 * * 1-5");
    assert.equal(game?.revealCron, "0 17 * * 1-5");
  });

  it("omitting prepCron on update keeps the existing value", async () => {
    primeBridge({ games: [{ ...baseGame, prepCron: "30 8 * * 1-5" }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", enabled: false }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.prepCron, "30 8 * * 1-5");
    assert.equal(game?.enabled, false);
  });

  it("passing prepCron: null clears it (opt out of pre-staging)", async () => {
    primeBridge({ games: [{ ...baseGame, prepCron: "30 8 * * 1-5" }] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(args({ name: "main", prepCron: null }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.prepCron, undefined);
  });

  it("rejects invalid prepCron expression", async () => {
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({ games: [] });
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
    primeBridge({
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

describe("upsert_game — shadowing detection", () => {
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("reports season shadowing of a written axis field", async () => {
    primeBridge({ games: [baseGame] });
    const data = createInMemoryDataLayer();
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
    primeBridge({ games: [baseGame] });
    const data = createInMemoryDataLayer();
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

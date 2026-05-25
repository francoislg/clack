import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createUpsertGameTool } from "./upsertGame.js";
import {
  _resetTriviaConfigBridge,
  _setTriviaConfigForTests,
  _setTriviaConfigSdkForTests,
  loadTriviaConfig,
} from "../../core/configBridge.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaConfig, TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

interface FakeSdkState {
  writes: Map<string, string>;
}

function makeFakeSdk(state: FakeSdkState): ClackSdk {
  return {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    addInstruction: () => {},
    addTopicInstruction: () => {},
    registerTool: () => {},
    registerIntegration: () => {},
    readFile: async (path) => state.writes.get(path) ?? null,
    writeFile: async (path, content) => {
      state.writes.set(path, content);
    },
    watchFile: () => {
      throw new Error("watchFile not used in upsert_game tests");
    },
    reconcileCronJobs: async () => {},
    dmOwner: async () => ({ ok: true as const }),
    getSlackClient: () => null,
    registerAction: () => {},
    registerView: () => {},
    actionId: (key: string) => `plugin:test:${key}`,
    viewCallbackId: (key: string) => `plugin:test:${key}`,
    askClaude: async () => ({
      text: "",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
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

describe("upsert_game — create branch", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("creates a new game with all required fields", async () => {
    primeBridge({ games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        {
          name: "engineering",
          channel: "C999",
          questionCron: "0 9 * * 1-5",
          revealCron: "0 17 * * 1-5",
          timezone: "UTC",
          enabled: undefined,
          answersFormat: undefined,
          questionType: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(result.action, "created");
    assert.equal(result.name, "engineering");
    assert.equal(result.enabled, true);
    assert.equal(result.hasAxisOverrides, false);

    const next = loadTriviaConfig();
    assert.equal(next?.games?.length, 1);
    assert.equal(next?.games?.[0]?.name, "engineering");
  });

  it("creates a game with per-game axis overrides", async () => {
    primeBridge({ games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        {
          name: "engineering",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: undefined,
          answersFormat: { boolean: 0, choice: 1 },
          questionType: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(result.hasAxisOverrides, true);
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.answersFormat, { boolean: 0, choice: 1, freeform: 0 });
  });

  it("rejects create when scheduling fields are missing", async () => {
    primeBridge({ games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        {
          name: "incomplete",
          channel: "C1",
          // missing questionCron / revealCron / timezone
          questionCron: undefined,
          revealCron: undefined,
          timezone: undefined,
          enabled: undefined,
          answersFormat: undefined,
          questionType: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
        },
        SESSION,
      ),
    );
    assert.match(result.error, /Creating a new game requires/);
  });

  it("rejects invalid cron expression", async () => {
    primeBridge({ games: [] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(
      await tool.handler(
        {
          name: "badcron",
          channel: "C1",
          questionCron: "not a cron",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: undefined,
          answersFormat: undefined,
          questionType: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
        },
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
        {
          name: "Bad Name!",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: undefined,
          answersFormat: undefined,
          questionType: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
        },
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
        {
          name: "test",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: undefined,
          answersFormat: { boolean: 0, choice: 0 },
          questionType: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
        },
        SESSION,
      ),
    );
    assert.match(result.error, /at least one strictly positive weight/);
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
      await tool.handler(
        {
          name: "main",
          channel: undefined,
          questionCron: "0 10 * * *",
          revealCron: undefined,
          timezone: undefined,
          enabled: undefined,
          answersFormat: undefined,
          questionType: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
        },
        SESSION,
      ),
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
    await tool.handler(
      {
        name: "main",
        channel: undefined,
        questionCron: undefined,
        revealCron: undefined,
        timezone: undefined,
        enabled: undefined,
        answersFormat: { boolean: 1, choice: 1 },
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
      },
      SESSION,
    );
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.answersFormat, { boolean: 1, choice: 1, freeform: 0 });
  });

  it("clears an axis override with explicit null", async () => {
    primeBridge({
      games: [{ ...baseGame, answersFormat: { boolean: 1, choice: 1, freeform: 0 } }],
    });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(
      {
        name: "main",
        channel: undefined,
        questionCron: undefined,
        revealCron: undefined,
        timezone: undefined,
        enabled: undefined,
        answersFormat: null,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
      },
      SESSION,
    );
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
    await tool.handler(
      {
        name: "main",
        channel: undefined,
        questionCron: undefined,
        revealCron: undefined,
        timezone: undefined,
        enabled: undefined,
        answersFormat: undefined, // omit-to-keep
        questionType: { fact: 0, topical: 1 }, // replace
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
      },
      SESSION,
    );
    const game = loadTriviaConfig()?.games?.[0];
    assert.deepEqual(game?.answersFormat, { boolean: 1, choice: 1, freeform: 0 });
    assert.deepEqual(game?.questionType, { fact: 0, topical: 1 });
  });

  it("toggles enabled to false", async () => {
    primeBridge({ games: [baseGame] });
    const tool = createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
    await tool.handler(
      {
        name: "main",
        channel: undefined,
        questionCron: undefined,
        revealCron: undefined,
        timezone: undefined,
        enabled: false,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
      },
      SESSION,
    );
    const game = loadTriviaConfig()?.games?.[0];
    assert.equal(game?.enabled, false);
  });
});

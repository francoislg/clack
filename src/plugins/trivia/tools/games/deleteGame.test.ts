import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createDeleteGameTool } from "./deleteGame.js";
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

function makeFakeSdk(): ClackSdk {
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
    readFile: async () => null,
    writeFile: async () => {},
    watchFile: () => {
      throw new Error("watchFile not used in delete_game tests");
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

function primeBridge(initial: TriviaConfig | null): void {
  _resetTriviaConfigBridge();
  _setTriviaConfigSdkForTests(makeFakeSdk());
  _setTriviaConfigForTests(initial);
}

const baseGame: TriviaGame = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 17 * * 1-5",
  timezone: "America/Montreal",
  enabled: true,
};

describe("delete_game", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("removes a registered game", async () => {
    primeBridge({ games: [baseGame, { ...baseGame, name: "other", channel: "C2" }] });
    const tool = createDeleteGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(await tool.handler({ name: "main" }, SESSION));
    assert.equal(result.name, "main");
    assert.equal(result.action, "deleted");

    const games = loadTriviaConfig()?.games ?? [];
    assert.equal(games.length, 1);
    assert.equal(games[0]?.name, "other");
  });

  it("rejects unknown game", async () => {
    primeBridge({ games: [baseGame] });
    const tool = createDeleteGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(await tool.handler({ name: "ghost" }, SESSION));
    assert.match(result.error, /Unknown game/);

    // Registry should be untouched.
    assert.equal(loadTriviaConfig()?.games?.length, 1);
  });

  it("rejects unknown game when registry is empty", async () => {
    primeBridge({ games: [] });
    const tool = createDeleteGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(await tool.handler({ name: "anything" }, SESSION));
    assert.match(result.error, /Unknown game/);
  });
});

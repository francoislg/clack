import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createDeleteGameTool } from "./deleteGame.js";
import { loadTriviaConfig } from "../../core/configBridge.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import type { TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

const baseGame: TriviaGame = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 17 * * 1-5",
  timezone: "America/Montreal",
  enabled: true,
};

describe("delete_game", () => {
  it("removes a registered game", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame, { ...baseGame, name: "other", channel: "C2" }] });
    const tool = createDeleteGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(await tool.handler({ name: "main" }, SESSION));
    assert.equal(result.name, "main");
    assert.equal(result.action, "deleted");

    const games = loadTriviaConfig()?.games ?? [];
    assert.equal(games.length, 1);
    assert.equal(games[0]?.name, "other");
  });

  it("rejects unknown game", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [baseGame] });
    const tool = createDeleteGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(await tool.handler({ name: "ghost" }, SESSION));
    assert.match(result.error, /Unknown game/);

    // Registry should be untouched.
    assert.equal(loadTriviaConfig()?.games?.length, 1);
  });

  it("rejects unknown game when registry is empty", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [] });
    const tool = createDeleteGameTool(() => loadTriviaConfig()?.games ?? []);
    const result = parseToolResult(await tool.handler({ name: "anything" }, SESSION));
    assert.match(result.error, /Unknown game/);
  });
});

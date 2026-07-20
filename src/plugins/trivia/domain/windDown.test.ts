import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { windDownGame, WIND_DOWN_RECIPE } from "./windDown.js";
import { loadTriviaConfig } from "../core/configBridge.js";
import { FIXTURE_GAME_NAME, FIXTURE_GAMES } from "../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../testHelpers.fakeSdk.js";

describe("windDownGame", () => {
  it("persists enabled: false on the named game and returns the recipe", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: [
        ...FIXTURE_GAMES.map((g) => ({ ...g, disableAfterRound: true })),
        { ...FIXTURE_GAMES[0], name: "other", channel: "C200000000" },
      ],
    });

    const result = await windDownGame(FIXTURE_GAME_NAME);

    assert.equal(result.gameDisabled, true);
    assert.equal(result.alreadyWoundDown, undefined);
    assert.ok(result.message.includes(WIND_DOWN_RECIPE));
    const persisted = loadTriviaConfig();
    const game = persisted?.games?.find((g) => g.name === FIXTURE_GAME_NAME);
    assert.equal(game?.enabled, false);
    assert.equal(game?.disableAfterRound, true, "the standing flag survives");
    const other = persisted?.games?.find((g) => g.name === "other");
    assert.equal(other?.enabled, true, "sibling games untouched");
  });

  it("is a no-op success on an already-disabled game", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, {
      games: FIXTURE_GAMES.map((g) => ({ ...g, enabled: false, disableAfterRound: true })),
    });

    const result = await windDownGame(FIXTURE_GAME_NAME);

    assert.equal(result.gameDisabled, true);
    assert.equal(result.alreadyWoundDown, true);
    assert.ok(result.message.includes(WIND_DOWN_RECIPE));
  });

  it("throws on an unknown game instead of claiming success", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: FIXTURE_GAMES.map((g) => ({ ...g })) });

    await assert.rejects(() => windDownGame("no-such-game"), /unknown game "no-such-game"/);
  });

  it("exposes a non-empty correction recipe naming both upsert_game steps", () => {
    assert.ok(WIND_DOWN_RECIPE.includes("enabled: true"));
    assert.ok(WIND_DOWN_RECIPE.includes("enabled: false"));
  });
});

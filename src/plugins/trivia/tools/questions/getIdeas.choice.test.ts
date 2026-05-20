import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { Config } from "../../../../config.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };

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

describe("get_ideas weighted-random suggestedAnswersFormat", () => {
  let data: TriviaDataLayer;
  const originalRandom = Math.random;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories([]); // empty so random calls are predictable
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  const stubRng = (values: number[]) => {
    let i = 0;
    Math.random = () => values[i++ % values.length];
  };

  it("pure-boolean config: every call returns boolean + suggestedAnswer", async () => {
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 0 } });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    stubRng([0.5, 0.5, 0.5]); // type-roll → boolean (single positive weight); answer→true; difficulty→Medium
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedAnswersFormat, "boolean");
    assert.equal(typeof parsed.suggestedAnswer, "boolean");
    assert.equal(parsed.suggestedChoiceCount, undefined);
    assert.equal(parsed.suggestedCorrectIndex, undefined);
  });

  it("pure-choice config: every call returns choice + count/correctIndex", async () => {
    const cfg = makeConfig({ answersFormat: { boolean: 0, choice: 1 } });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    // rolls: type(→choice), count(uniform [2,4]), correctIndex(uniform [0, count)), difficulty
    stubRng([0.5, 0.99, 0.5, 0.5]);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedAnswersFormat, "choice");
    assert.equal(typeof parsed.suggestedChoiceCount, "number");
    assert.ok(parsed.suggestedChoiceCount >= 2 && parsed.suggestedChoiceCount <= 4);
    assert.equal(typeof parsed.suggestedCorrectIndex, "number");
    assert.ok(parsed.suggestedCorrectIndex >= 0);
    assert.ok(parsed.suggestedCorrectIndex < parsed.suggestedChoiceCount);
    assert.equal(parsed.suggestedAnswer, undefined);
  });

  it("mixed config (2:1): distribution is approximately 2/3 boolean over many rolls", async () => {
    const cfg = makeConfig({ answersFormat: { boolean: 2, choice: 1 } });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    Math.random = originalRandom; // real RNG for distribution
    const N = 1500;
    let booleans = 0;
    let choices = 0;
    for (let i = 0; i < N; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      if (parsed.suggestedAnswersFormat === "boolean") booleans++;
      else choices++;
    }
    const ratio = booleans / N;
    assert.ok(Math.abs(ratio - 2 / 3) < 0.05, `boolean ratio off: ${ratio}`);
    assert.equal(booleans + choices, N);
  });

  it("respects active choice bounds: { min: 4, max: 4 } always rolls 4", async () => {
    const cfg = makeConfig({
      answersFormat: { boolean: 0, choice: 1 },
      choices: { min: 4, max: 4 },
    });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    Math.random = originalRandom;
    for (let i = 0; i < 50; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      assert.equal(parsed.suggestedChoiceCount, 4);
      assert.ok(parsed.suggestedCorrectIndex >= 0 && parsed.suggestedCorrectIndex < 4);
    }
  });

  it("suggestedCorrectIndex distribution is uniform over many rolls", async () => {
    const cfg = makeConfig({
      answersFormat: { boolean: 0, choice: 1 },
      choices: { min: 4, max: 4 },
    });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    Math.random = originalRandom;
    const N = 2000;
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      counts[parsed.suggestedCorrectIndex]++;
    }
    for (let i = 0; i < 4; i++) {
      const ratio = counts[i] / N;
      assert.ok(Math.abs(ratio - 0.25) < 0.05, `correctIndex ${i} ratio off: ${ratio}`);
    }
  });

  it("falls back to pure-boolean when no config and no current season", async () => {
    const tool = createGetIdeasTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedAnswersFormat, "boolean");
  });

  it("current season's questionTypes overrides config (seasons enabled)", async () => {
    // Set up an active season with choice-only questionTypes
    const now = Date.now();
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
      seasons: [
        {
          slug: "active",
          startedAt: now - 1000,
          expectedEndAt: now + 100_000,
          categories: ["X"],
          answersFormat: { boolean: 0, choice: 1 },
        },
      ],
    });
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "monthly" },
      answersFormat: { boolean: 1, choice: 0 },
    });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    Math.random = originalRandom;
    for (let i = 0; i < 20; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      assert.equal(parsed.suggestedAnswersFormat, "choice");
    }
  });
});

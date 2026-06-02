import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer } from "../../testHelpers.js";
import { createExplainCascadeTool } from "./explainCascade.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaConfig, TriviaGame } from "../../core/configTypes.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };

const baseGame: TriviaGame = {
  name: "g",
  channel: "C1",
  questionCron: "0 9 * * *",
  revealCron: "0 17 * * *",
  timezone: "UTC",
};

describe("explain_cascade", () => {
  let data: TriviaDataLayer;
  beforeEach(() => {
    data = createInMemoryDataLayer();
  });

  it("explains the single-question coordinate when there is no format", async () => {
    const game: TriviaGame = { ...baseGame, promptMedium: { text: 0, image: 1 } };
    const tool = createExplainCascadeTool(
      data,
      () => null,
      () => [game],
    );
    const parsed = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );

    assert.equal(parsed.coordinates.length, 1);
    assert.equal(parsed.coordinates[0].slot, null);
    const pm = parsed.coordinates[0].axes.promptMedium;
    assert.deepEqual(pm.value, { text: 0, image: 1 });
    assert.equal(pm.tier, "game");
  });

  it("reports the winning tier and a per-tier ladder", async () => {
    const game: TriviaGame = { ...baseGame, judgeLeniency: "lenient" };
    const config: TriviaConfig = { judgeLeniency: "strict" };
    const tool = createExplainCascadeTool(
      data,
      () => config,
      () => [game],
    );
    const parsed = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );

    const jl = parsed.coordinates[0].axes.judgeLeniency;
    assert.equal(jl.value, "lenient");
    assert.equal(jl.tier, "game");
    // ladder has the four concrete tiers; game is the winner, workspace present but not.
    const gameRung = jl.ladder.find((r: { tier: string }) => r.tier === "game");
    const wsRung = jl.ladder.find((r: { tier: string }) => r.tier === "workspace");
    assert.equal(gameRung.winner, true);
    assert.equal(wsRung.present, true);
    assert.equal(wsRung.winner, false);
  });

  it("renders difficulty per answersFormat by default, focused when one is supplied", async () => {
    const tool = createExplainCascadeTool(
      data,
      () => null,
      () => [baseGame],
    );
    const all = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );
    const diff = all.coordinates[0].axes.difficulty;
    assert.ok(diff.byAnswersFormat.boolean);
    assert.ok(diff.byAnswersFormat.choice);
    assert.ok(diff.byAnswersFormat.freeform);

    const focused = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: "boolean" }, SESSION),
    );
    const fdiff = focused.coordinates[0].axes.difficulty;
    assert.equal(fdiff.byAnswersFormat, undefined);
    assert.ok(fdiff.value);
  });

  it("rejects an unknown game", async () => {
    const tool = createExplainCascadeTool(
      data,
      () => null,
      () => [baseGame],
    );
    const res = await tool.handler(
      { game: "nope", slot: undefined, answersFormat: undefined },
      SESSION,
    );
    assert.equal(res.isError, true);
  });

  it("rejects a slot when there is no format", async () => {
    const tool = createExplainCascadeTool(
      data,
      () => null,
      () => [baseGame],
    );
    const res = await tool.handler({ game: "g", slot: 0, answersFormat: undefined }, SESSION);
    assert.equal(res.isError, true);
  });

  it("explains every slot of a game format when no slot is given", async () => {
    const game: TriviaGame = {
      ...baseGame,
      format: { questions: [{ label: "Q1" }, { label: "Q2" }] },
    };
    const tool = createExplainCascadeTool(
      data,
      () => null,
      () => [game],
    );
    const parsed = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );
    assert.equal(parsed.coordinates.length, 2);
    assert.equal(parsed.coordinates[0].slot, 0);
    assert.equal(parsed.coordinates[1].slot, 1);
  });
});

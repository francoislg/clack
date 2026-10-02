import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createTriviaDataLayer, type FakeTriviaDataLayer } from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createExplainCascadeTool } from "./explainCascade.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaConfig, TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

const baseGame: TriviaGame = {
  name: "g",
  channel: "C1",
  questionCron: "0 9 * * *",
  revealCron: "0 17 * * *",
  timezone: "UTC",
};

describe("explain_cascade", () => {
  let data: FakeTriviaDataLayer;
  beforeEach(() => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const result = createTriviaDataLayer(sdk);
    data = result.dataLayer;
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

  it("shows both contributing tiers and the merged judgeInstructions value", async () => {
    const now = Date.now();
    await data.forGame("g").saveSeasonsState({
      seasons: [
        {
          slug: "s1",
          startedAt: now - 86_400_000,
          expectedEndAt: now + 86_400_000,
          judgeInstructions: "Riddles: metaphorical solves count.",
        },
      ],
    });
    const config: TriviaConfig = {
      seasons: { enabled: true, prompt: "p" },
      judgeInstructions: "Accept French or English.",
    };
    const tool = createExplainCascadeTool(
      data,
      () => config,
      () => [baseGame],
    );
    const parsed = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );

    const ji = parsed.coordinates[0].axes.judgeInstructions;
    assert.equal(
      ji.value,
      "[Workspace] Accept French or English.\n\n[Season] Riddles: metaphorical solves count.",
    );
    assert.equal(ji.tier, "merged");
    const contributing = ji.ladder
      .filter((r: { winner: boolean }) => r.winner)
      .map((r: { tier: string }) => r.tier);
    assert.deepEqual(contributing, ["season", "workspace"]);
  });

  it("reports judgeInstructions as unset at the default tier when no tier sets it", async () => {
    const tool = createExplainCascadeTool(
      data,
      () => null,
      () => [baseGame],
    );
    const parsed = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );
    const ji = parsed.coordinates[0].axes.judgeInstructions;
    assert.equal(ji.value, null);
    assert.equal(ji.tier, "default");
  });

  it("explains the evaluate judgeLeniency preset at the tier that set it", async () => {
    const game: TriviaGame = { ...baseGame, judgeLeniency: "evaluate" };
    const tool = createExplainCascadeTool(
      data,
      () => null,
      () => [game],
    );
    const parsed = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );
    const jl = parsed.coordinates[0].axes.judgeLeniency;
    assert.equal(jl.value, "evaluate");
    assert.equal(jl.tier, "game");
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

describe("explain_cascade — season phases", () => {
  const DAY = 86_400_000;
  const seasonsConfig: TriviaConfig = { seasons: { enabled: true, prompt: "p" } };
  let data: FakeTriviaDataLayer;

  beforeEach(() => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { seasons: { enabled: true, prompt: "p" } });
    data = createTriviaDataLayer(sdk).dataLayer;
  });

  // A current season (window contains `now`) whose active slice at `now` is the
  // open-ended "finale" — "opening" occupies the first 5 days and has already elapsed.
  async function seedPhasedSeason(): Promise<void> {
    const now = Date.now();
    await data.forGame("g").saveSeasonsState({
      seasons: [
        {
          slug: "s1",
          startedAt: now - 10 * DAY,
          expectedEndAt: now + 10 * DAY,
          phases: [
            { slug: "opening", days: 5 },
            { slug: "finale", judgeLeniency: "lenient" },
          ],
        },
      ],
    });
  }

  it("names the active phase and its computed window", async () => {
    await seedPhasedSeason();
    const tool = createExplainCascadeTool(
      data,
      () => seasonsConfig,
      () => [baseGame],
    );
    const parsed = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );
    assert.equal(parsed.activePhase.slug, "finale");
    assert.equal(typeof parsed.activePhase.start, "number");
    assert.equal(typeof parsed.activePhase.end, "number");
    assert.ok(parsed.activePhase.start < parsed.activePhase.end);
  });

  it("reports tier seasonPhase for an axis only the active phase sets", async () => {
    await seedPhasedSeason();
    const tool = createExplainCascadeTool(
      data,
      () => seasonsConfig,
      () => [baseGame],
    );
    const parsed = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );
    const jl = parsed.coordinates[0].axes.judgeLeniency;
    assert.equal(jl.value, "lenient");
    assert.equal(jl.tier, "seasonPhase");
    const rung = jl.ladder.find((r: { tier: string }) => r.tier === "seasonPhase");
    assert.equal(rung.winner, true);
    assert.equal(rung.present, true);
  });

  it("reports activePhase: null for a current season that declares no phases", async () => {
    const now = Date.now();
    await data.forGame("g").saveSeasonsState({
      seasons: [{ slug: "s1", startedAt: now - DAY, expectedEndAt: now + DAY }],
    });
    const tool = createExplainCascadeTool(
      data,
      () => seasonsConfig,
      () => [baseGame],
    );
    const parsed = parseToolResult(
      await tool.handler({ game: "g", slot: undefined, answersFormat: undefined }, SESSION),
    );
    assert.equal(parsed.activePhase, null);
    assert.equal(parsed.coordinates.length, 1);
    assert.equal(parsed.coordinates[0].slot, null);
  });
});

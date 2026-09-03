import { describe, it, beforeEach, expect } from "vitest";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaConfig } from "../../core/configTypes.js";
import type { SeasonsState } from "../../core/types.js";

/**
 * `get_ideas` builds its `cascadeCtx` with `{ at: now }`, so an active phase's
 * theme / categories / instructions must thread through the theme, categories, and
 * instruction resolvers and surface in the tool response. The resolvers themselves
 * are unit-covered in `domain/{categories,theme}.test.ts`; this asserts the tool
 * boundary wires the phase-aware context into those calls.
 */

const SESSION = { sessionId: "test" };
const DAY = 86_400_000;

describe("get_ideas — phase-level theme/categories/instructions at the tool boundary", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;
    data.loadCategories.mockResolvedValue(["GlobalA", "GlobalB", "GlobalC"]);
  });

  /**
   * A season active now whose FIRST phase (`ramp`, days: 1) is the active slice:
   * `startedAt` sits half a day back, so `now` lands inside `ramp`'s window.
   */
  function seedActiveRampSeason(state: Partial<SeasonsState["seasons"][number]>): void {
    const now = Date.now();
    const seasonsState: SeasonsState = {
      seasons: [
        {
          slug: "s1",
          startedAt: now - DAY / 2,
          expectedEndAt: now + 20 * DAY,
          phases: [{ slug: "ramp", days: 1 }, { slug: "gauntlet" }],
          ...state,
        },
      ],
    };
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue(seasonsState);
  }

  it("reports source 'phase' and draws ideas from the phase's pool when the active phase sets categories", async () => {
    seedActiveRampSeason({
      categories: ["SeasonCat1", "SeasonCat2"],
      phases: [
        { slug: "ramp", days: 1, categories: ["PhaseCatA", "PhaseCatB", "PhaseCatC"] },
        { slug: "gauntlet" },
      ],
    });

    const tool = createGetIdeasTool(data, () => ({}), fixtureGetGames);
    const result = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );

    expect(result.categories.source).toBe("phase");
    expect(result.categories.total).toBe(3);
    for (const idea of result.categories.ideas) {
      expect(["PhaseCatA", "PhaseCatB", "PhaseCatC"]).toContain(idea);
    }
  });

  it("reflects the phase's theme, overriding the season theme", async () => {
    seedActiveRampSeason({
      theme: "Season Theme",
      phases: [{ slug: "ramp", days: 1, theme: "Phase Theme" }, { slug: "gauntlet" }],
    });

    const tool = createGetIdeasTool(data, () => ({}), fixtureGetGames);
    const result = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );

    expect(result.theme).toBe("Phase Theme");
  });

  it("includes the [Phase] segment in additionalInstructions when the active phase sets it", async () => {
    seedActiveRampSeason({
      additionalInstructions: "Season extra.",
      phases: [
        { slug: "ramp", days: 1, additionalInstructions: "Phase extra." },
        { slug: "gauntlet" },
      ],
    });

    const cfg: TriviaConfig = { additionalInstructions: "Workspace extra." };
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    const result = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );

    expect(result.additionalInstructions).toBe(
      "[Workspace] Workspace extra.\n\n[Season] Season extra.\n\n[Phase] Phase extra.",
    );
  });

  it("produces exactly the pre-phase values for a phaseless season", async () => {
    const now = Date.now();
    const seasonsState: SeasonsState = {
      seasons: [
        {
          slug: "s1",
          startedAt: now - DAY,
          expectedEndAt: now + 20 * DAY,
          categories: ["SeasonCat1", "SeasonCat2"],
          theme: "Season Theme",
          instructions: "Season rule.",
          additionalInstructions: "Season extra.",
        },
      ],
    };
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue(seasonsState);

    const tool = createGetIdeasTool(data, () => ({}), fixtureGetGames);
    const result = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );

    expect(result.categories.source).toBe("season");
    expect(result.categories.total).toBe(2);
    for (const idea of result.categories.ideas) {
      expect(["SeasonCat1", "SeasonCat2"]).toContain(idea);
    }
    expect(result.theme).toBe("Season Theme");
    expect(result.instructions).toBe("Season rule.");
    expect(result.additionalInstructions).toBe("[Season] Season extra.");
  });
});

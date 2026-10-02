import { describe, it, beforeEach, expect } from "vitest";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createListSeasonsTool } from "./listSeasons.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { SeasonEntry } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

describe("list_seasons — judgeInstructions and judgeLeniency", () => {
  let data: FakeTriviaDataLayer;
  let now: number;

  beforeEach(() => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    data = createTriviaDataLayer(sdk).dataLayer;
    now = Date.now();
  });

  async function listSeasons(entries: SeasonEntry[]) {
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({ seasons: entries });
    data.loadCategories.mockResolvedValue(["Science"]);
    const tool = createListSeasonsTool(data, fixtureGetGames);
    return parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION));
  }

  it("surfaces both fields at the season tier, present-iff-set", async () => {
    const parsed = await listSeasons([
      {
        slug: "riddles",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        judgeInstructions: "Metaphorical solves count.",
        judgeLeniency: "evaluate",
      },
      { slug: "plain", startedAt: now + 30 * DAY, expectedEndAt: now + 60 * DAY },
    ]);
    const [riddles, plain] = parsed.seasons;
    expect(riddles.judgeInstructions).toBe("Metaphorical solves count.");
    expect(riddles.judgeLeniency).toBe("evaluate");
    expect("judgeInstructions" in plain).toBe(false);
    expect("judgeLeniency" in plain).toBe(false);
  });

  it("surfaces both fields on format.questions[i], present-iff-set", async () => {
    const parsed = await listSeasons([
      {
        slug: "slotted",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        format: {
          questions: [
            { label: "Q1" },
            { label: "Q2", judgeInstructions: "Slot rule.", judgeLeniency: "evaluate" },
          ],
        },
      },
    ]);
    const slots = parsed.seasons[0].format.questions;
    expect(slots[0]).toEqual({ label: "Q1" });
    expect(slots[1]).toEqual({
      label: "Q2",
      judgeInstructions: "Slot rule.",
      judgeLeniency: "evaluate",
    });
  });

  it("surfaces both fields on slotOverrides entries", async () => {
    const parsed = await listSeasons([
      {
        slug: "overridden",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        slotOverrides: {
          1: { judgeInstructions: "Override rule." },
          2: { judgeLeniency: "lenient" },
        },
      },
    ]);
    expect(parsed.seasons[0].slotOverrides).toEqual({
      1: { judgeInstructions: "Override rule." },
      2: { judgeLeniency: "lenient" },
    });
  });
});

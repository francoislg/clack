import { describe, it, beforeEach, expect } from "vitest";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { upsertSeasonArgs, type UpsertSeasonArgs } from "./upsertSeason.testHelpers.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { SeasonEntry } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function args(
  slug: string,
  startedAt: number | undefined,
  overrides: Partial<UpsertSeasonArgs> = {},
): UpsertSeasonArgs {
  return upsertSeasonArgs({
    game: FIXTURE_GAME_NAME,
    slug,
    startedAt,
    expectedEndAt: startedAt === undefined ? undefined : startedAt + 30 * DAY,
    ...overrides,
  });
}

describe("upsert_season — judgeInstructions", () => {
  let data: FakeTriviaDataLayer;
  let future: number;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    data = createTriviaDataLayer(sdk).dataLayer;
    await data.saveCategories(["Science", "History"]);
    future = Date.now() + 30 * DAY;
  });

  async function loadSeason(slug: string): Promise<SeasonEntry | undefined> {
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    return state?.seasons.find((s) => s.slug === slug);
  }

  describe("season tier", () => {
    it("create persists the trimmed value and reports hasJudgeInstructions", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      const result = parseToolResult(
        await tool.handler(
          args("riddles", future, { judgeInstructions: "  Metaphorical solves count.  " }),
          SESSION,
        ),
      );
      expect(result.action).toBe("created");
      expect(result.hasJudgeInstructions).toBe(true);
      expect((await loadSeason("riddles"))?.judgeInstructions).toBe("Metaphorical solves count.");
    });

    it("create without the argument leaves the field absent", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      const result = parseToolResult(await tool.handler(args("plain", future), SESSION));
      expect(result.hasJudgeInstructions).toBe(false);
      const entry = await loadSeason("plain");
      expect(entry !== undefined && "judgeInstructions" in entry).toBe(false);
    });

    it("update replaces an existing value", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      await tool.handler(args("riddles", future, { judgeInstructions: "Old rule." }), SESSION);
      const result = parseToolResult(
        await tool.handler(args("riddles", undefined, { judgeInstructions: "New rule." }), SESSION),
      );
      expect(result.action).toBe("updated");
      expect(result.hasJudgeInstructions).toBe(true);
      expect((await loadSeason("riddles"))?.judgeInstructions).toBe("New rule.");
    });

    it("update with null clears the tier and leaves additionalInstructions alone", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      await tool.handler(
        args("riddles", future, {
          judgeInstructions: "Old rule.",
          additionalInstructions: "Favor spooky angles.",
        }),
        SESSION,
      );
      const result = parseToolResult(
        await tool.handler(args("riddles", undefined, { judgeInstructions: null }), SESSION),
      );
      expect(result.hasJudgeInstructions).toBe(false);
      const entry = await loadSeason("riddles");
      expect(entry?.judgeInstructions).toBeUndefined();
      expect(entry?.additionalInstructions).toBe("Favor spooky angles.");
    });

    it("update with the argument omitted keeps the existing value", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      await tool.handler(args("riddles", future, { judgeInstructions: "Keep me." }), SESSION);
      await tool.handler(args("riddles", undefined, { theme: "Riddle month" }), SESSION);
      const entry = await loadSeason("riddles");
      expect(entry?.judgeInstructions).toBe("Keep me.");
      expect(entry?.theme).toBe("Riddle month");
    });

    it("rejects an empty / whitespace-only string on create, naming the field", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      const result = parseToolResult(
        await tool.handler(args("blank", future, { judgeInstructions: "   " }), SESSION),
      );
      expect(result.error).toMatch(/judgeInstructions must be non-empty/);
      expect(await loadSeason("blank")).toBeUndefined();
    });

    it("rejects an empty / whitespace-only string on update and keeps the stored value", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      await tool.handler(args("riddles", future, { judgeInstructions: "Keep me." }), SESSION);
      const result = parseToolResult(
        await tool.handler(args("riddles", undefined, { judgeInstructions: "  " }), SESSION),
      );
      expect(result.error).toMatch(/judgeInstructions must be non-empty/);
      expect((await loadSeason("riddles"))?.judgeInstructions).toBe("Keep me.");
    });
  });

  describe("slot tier", () => {
    it("persists the value on a format slot", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      await tool.handler(
        args("slotted", future, {
          format: { questions: [{ label: "Q1" }, { judgeInstructions: " Slot rule. " }] },
        }),
        SESSION,
      );
      const entry = await loadSeason("slotted");
      expect(entry?.format?.questions[0]?.judgeInstructions).toBeUndefined();
      expect(entry?.format?.questions[1]?.judgeInstructions).toBe("Slot rule.");
    });

    it("persists the value on a slotOverrides entry", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      await tool.handler(
        args("overridden", future, {
          slotOverrides: [{ slot: 2, overrides: { judgeInstructions: "Override rule." } }],
        }),
        SESSION,
      );
      expect((await loadSeason("overridden"))?.slotOverrides).toEqual({
        2: { judgeInstructions: "Override rule." },
      });
    });

    it("rejects an empty slot value, naming the slot and field", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      const result = parseToolResult(
        await tool.handler(
          args("bad-slot", future, { format: { questions: [{ judgeInstructions: "  " }] } }),
          SESSION,
        ),
      );
      expect(result.error).toMatch(/format\.questions\[0\]\.judgeInstructions.*non-empty/);
      expect(await loadSeason("bad-slot")).toBeUndefined();
    });
  });

  describe("phase tier", () => {
    it("persists judgeInstructions and the evaluate judgeLeniency preset on a slice", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      const result = parseToolResult(
        await tool.handler(
          args("phased", future, {
            phases: [
              { slug: "warmup", days: 5 },
              {
                slug: "riddles",
                judgeLeniency: "evaluate",
                judgeInstructions: " Metaphorical solves count. ",
              },
            ],
          }),
          SESSION,
        ),
      );
      expect(result.action).toBe("created");
      expect((await loadSeason("phased"))?.phases).toEqual([
        { slug: "warmup", days: 5 },
        {
          slug: "riddles",
          judgeLeniency: "evaluate",
          judgeInstructions: "Metaphorical solves count.",
        },
      ]);
    });

    it("an update replacing phases drops a slice's judgeInstructions", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      await tool.handler(
        args("phased", future, { phases: [{ slug: "only", judgeInstructions: "Rule." }] }),
        SESSION,
      );
      await tool.handler(args("phased", undefined, { phases: [{ slug: "only" }] }), SESSION);
      expect((await loadSeason("phased"))?.phases).toEqual([{ slug: "only" }]);
    });

    it("rejects an empty slice value, naming the slice and field", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      const result = parseToolResult(
        await tool.handler(
          args("bad-phase", future, { phases: [{ slug: "only", judgeInstructions: "   " }] }),
          SESSION,
        ),
      );
      expect(result.error).toMatch(/phase "only"\.judgeInstructions.*non-empty/);
      expect(await loadSeason("bad-phase")).toBeUndefined();
    });
  });

  describe("judgeLeniency evaluate preset", () => {
    it("sets evaluate at the season tier and on a slot override", async () => {
      const tool = createUpsertSeasonTool(data, fixtureGetGames);
      const result = parseToolResult(
        await tool.handler(
          args("evaluated", future, {
            judgeLeniency: "evaluate",
            slotOverrides: [{ slot: 0, overrides: { judgeLeniency: "evaluate" } }],
          }),
          SESSION,
        ),
      );
      expect(result.hasJudgeLeniency).toBe(true);
      const entry = await loadSeason("evaluated");
      expect(entry?.judgeLeniency).toBe("evaluate");
      expect(entry?.slotOverrides).toEqual({ 0: { judgeLeniency: "evaluate" } });
    });
  });
});

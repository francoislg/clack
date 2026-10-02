import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { upsertSeasonArgs } from "./upsertSeason.testHelpers.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

type PhaseArg = {
  slug: string;
  days?: number;
  theme?: string;
  categories?: string[];
  /** Disallowed structural key — present only to exercise the strict rejection path. */
  format?: { questions: string[] };
  /** A per-tier axis field — present to exercise the deep semantic-validation path. */
  answersFormat?: Record<string, number>;
  /** A typo of `judgeLeniency` — present to exercise the unknown-key rejection path. */
  judgeLenient?: string;
};

function baseArgs(slug: string, future: number) {
  return upsertSeasonArgs({
    game: FIXTURE_GAME_NAME,
    slug,
    startedAt: future,
    expectedEndAt: future + 30 * DAY,
  });
}

/** A valid three-slice chain: two dated slices then an open-ended final slice. */
const VALID_PHASES: PhaseArg[] = [
  { slug: "early", days: 10, theme: "Openers" },
  { slug: "mid", days: 10 },
  { slug: "finale" },
];

describe("upsert_season — phases argument", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const result = createTriviaDataLayer(sdk);
    data = result.dataLayer;
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("create with phases persists the array and reports hasPhases: true", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const parsed = parseToolResult(
      await tool.handler({ ...baseArgs("chained", future), phases: VALID_PHASES }, SESSION),
    );
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasPhases, true);
    assert.equal(parsed.phasesCount, 3);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "chained");
    assert.deepEqual(entry?.phases, VALID_PHASES);
  });

  it("create without phases leaves the field absent and reports hasPhases: false", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const parsed = parseToolResult(await tool.handler(baseArgs("no-phases", future), SESSION));
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasPhases, false);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "no-phases");
    assert.ok(entry !== undefined);
    assert.equal(entry?.phases, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, "phases"));
  });

  it("update replaces the phases array wholesale", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler({ ...baseArgs("wholesale", future), phases: VALID_PHASES }, SESSION);

    const replacement: PhaseArg[] = [{ slug: "opening-act", days: 5 }, { slug: "main-event" }];
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...baseArgs("wholesale", future),
          startedAt: undefined,
          expectedEndAt: undefined,
          phases: replacement,
        },
        SESSION,
      ),
    );
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.hasPhases, true);
    assert.equal(parsed.phasesCount, 2);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "wholesale");
    assert.deepEqual(entry?.phases, replacement);
  });

  it("update omitting phases preserves the existing value", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler({ ...baseArgs("kept", future), phases: VALID_PHASES }, SESSION);

    const parsed = parseToolResult(
      await tool.handler(
        { ...baseArgs("kept", future), startedAt: undefined, expectedEndAt: future + 45 * DAY },
        SESSION,
      ),
    );
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.hasPhases, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "kept");
    assert.deepEqual(entry?.phases, VALID_PHASES);
  });

  it("update with phases: null clears the field", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler({ ...baseArgs("cleared", future), phases: VALID_PHASES }, SESSION);

    const parsed = parseToolResult(
      await tool.handler(
        {
          ...baseArgs("cleared", future),
          startedAt: undefined,
          expectedEndAt: undefined,
          phases: null,
        },
        SESSION,
      ),
    );
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.hasPhases, false);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "cleared");
    assert.equal(entry?.phases, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, "phases"));
  });

  it("create trims/dedupes valid phase axis fields (theme trimmed, categories deduped)", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      {
        ...baseArgs("normalized", future),
        phases: [
          { slug: "opener", days: 7, theme: "  Kickoff  ", categories: ["Science", "Science"] },
          { slug: "closer" },
        ],
      },
      SESSION,
    );

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "normalized");
    assert.equal(entry?.phases?.[0].theme, "Kickoff");
    assert.deepEqual(entry?.phases?.[0].categories, ["Science"]);
  });

  // --- reject-on-invalid, on-disk season left unmodified ---

  async function seedWithPhases(slug: string, future: number): Promise<void> {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    await tool.handler({ ...baseArgs(slug, future), phases: VALID_PHASES }, SESSION);
  }

  async function assertRejectedUnchanged(slug: string, invalid: PhaseArg[]): Promise<string> {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...baseArgs(slug, future),
          startedAt: undefined,
          expectedEndAt: undefined,
          phases: invalid,
        },
        SESSION,
      ),
    );
    assert.ok(parsed.error || parsed.isError, "expected rejection for invalid phases");
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === slug);
    assert.deepEqual(entry?.phases, VALID_PHASES, "on-disk phases must be unchanged on rejection");
    return String(parsed.error ?? "");
  }

  it("rejects a duplicate phase slug and leaves the season unmodified", async () => {
    const future = Date.now() + 30 * DAY;
    await seedWithPhases("dup", future);
    const msg = await assertRejectedUnchanged("dup", [{ slug: "same", days: 5 }, { slug: "same" }]);
    assert.match(msg, /same/);
  });

  it("rejects a non-final slice missing days and leaves the season unmodified", async () => {
    const future = Date.now() + 30 * DAY;
    await seedWithPhases("no-days", future);
    const msg = await assertRejectedUnchanged("no-days", [{ slug: "first" }, { slug: "second" }]);
    assert.match(msg, /first/);
  });

  it("rejects a final slice declaring days and leaves the season unmodified", async () => {
    const future = Date.now() + 30 * DAY;
    await seedWithPhases("final-days", future);
    const msg = await assertRejectedUnchanged("final-days", [
      { slug: "a", days: 5 },
      { slug: "b", days: 5 },
    ]);
    assert.match(msg, /b/);
  });

  it("rejects a disallowed structural/scoring key naming the slice, leaving the season unmodified", async () => {
    const future = Date.now() + 30 * DAY;
    await seedWithPhases("bad-key", future);
    const msg = await assertRejectedUnchanged("bad-key", [
      { slug: "structural", days: 5, format: { questions: [] } },
      { slug: "tail" },
    ]);
    assert.match(msg, /structural/);
    assert.match(msg, /format/);
  });

  it("rejects an all-zero weight map naming slug + field, leaving the season unmodified", async () => {
    const future = Date.now() + 30 * DAY;
    await seedWithPhases("all-zero", future);
    const msg = await assertRejectedUnchanged("all-zero", [
      { slug: "opener", days: 5, answersFormat: { boolean: 0, choice: 0, freeform: 0 } },
      { slug: "tail" },
    ]);
    assert.match(msg, /opener/);
    assert.match(msg, /answersFormat/);
  });

  it("rejects a typo'd axis key with a generic unknown-field message, not scoring-identity", async () => {
    const future = Date.now() + 30 * DAY;
    await seedWithPhases("typo", future);
    const msg = await assertRejectedUnchanged("typo", [
      { slug: "opener", days: 5, judgeLenient: "strict" },
      { slug: "tail" },
    ]);
    assert.match(msg, /judgeLenient/);
    assert.match(msg, /unknown field/);
    assert.doesNotMatch(msg, /how a round is scored/);
  });
});

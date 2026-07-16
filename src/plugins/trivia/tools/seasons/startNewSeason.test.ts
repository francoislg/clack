import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { createStartNewSeasonTool } from "./startNewSeason.js";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";

/**
 * Tool-level tests for `start_new_season`. The rollover MECHANICS (continuation
 * inheritance, categories reset, endedAt re-stamp no-op) are covered at the
 * helper level in `../reveal/rollover.test.ts`; this file covers the tool's
 * own behavior: the last-fire confirmation guard, force override, closing the
 * current season, honoring a queued continuation, and degrading cleanly when
 * there is no current season or seasons aren't initialized.
 *
 * The clock is pinned to a weekday noon UTC so the fixture game's
 * revealCron ("0 17 * * 1-5", UTC) resolves to a deterministic next fire at
 * 17:00 the same day — letting each test choose `expectedEndAt` before or after
 * it to land on either side of the guard.
 */

const SESSION = { sessionId: "test" };
const DAY = 86_400_000;
// 2026-06-03 is a Wednesday; next reveal fire is 2026-06-03T17:00:00Z.
const PINNED_NOW = new Date("2026-06-03T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(PINNED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeTool(data: FakeTriviaDataLayer) {
  return createStartNewSeasonTool(data, fixtureGetGames);
}

describe("start_new_season", () => {
  it("closes the current season and creates a continuation", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const now = Date.now();
    await scoped.saveSeasonsState({
      seasons: [{ slug: "s1", startedAt: now - DAY, expectedEndAt: now + 60_000 }],
    });

    const res = parseToolResult(
      await makeTool(data).handler({ game: FIXTURE_GAME_NAME, force: undefined }, SESSION),
    );

    assert.equal(res.seasonClosed, true);
    assert.equal(res.closedSlug, "s1");
    assert.ok(res.newSeasonStarted, "a continuation should be created");

    const state = await scoped.loadSeasonsState();
    const s1 = state?.seasons.find((s) => s.slug === "s1");
    assert.ok(s1?.endedAt !== undefined, "s1 should be stamped endedAt");
    assert.equal(state?.seasons.length, 2);
  });

  it("honors an already-queued future continuation without duplicating it", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const now = Date.now();
    await scoped.saveSeasonsState({
      seasons: [
        { slug: "s1", startedAt: now - DAY, expectedEndAt: now + 60_000 },
        { slug: "s2-staged", startedAt: now + DAY, expectedEndAt: now + 30 * DAY },
      ],
    });

    const res = parseToolResult(
      await makeTool(data).handler({ game: FIXTURE_GAME_NAME, force: undefined }, SESSION),
    );

    assert.equal(res.seasonClosed, true);
    assert.equal(
      res.newSeasonStarted,
      undefined,
      "must not create a new season when one is queued",
    );

    const state = await scoped.loadSeasonsState();
    assert.equal(state?.seasons.length, 2, "no duplicate continuation created");
    assert.ok(state?.seasons.find((s) => s.slug === "s1")?.endedAt !== undefined);
  });

  it("is a no-op when there is no current season (a gap)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const now = Date.now();
    await scoped.saveSeasonsState({
      seasons: [
        { slug: "s0", startedAt: now - 2 * DAY, expectedEndAt: now - DAY, endedAt: now - DAY },
      ],
    });

    const res = parseToolResult(
      await makeTool(data).handler({ game: FIXTURE_GAME_NAME, force: undefined }, SESSION),
    );

    assert.equal(res.seasonClosed, false);
    const state = await scoped.loadSeasonsState();
    assert.equal(state?.seasons.length, 1, "state is untouched");
  });

  it("errors when seasons are not initialized", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const out = await makeTool(data).handler(
      { game: FIXTURE_GAME_NAME, force: undefined },
      SESSION,
    );
    assert.ok(out.isError);
  });

  it("confirmation guard: does NOT roll over when it is not the season's last fire", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const now = Date.now();
    // expectedEndAt is weeks past the next reveal fire → NOT the last fire.
    await scoped.saveSeasonsState({
      seasons: [{ slug: "s1", startedAt: now - DAY, expectedEndAt: now + 30 * DAY }],
    });

    const res = parseToolResult(
      await makeTool(data).handler({ game: FIXTURE_GAME_NAME, force: undefined }, SESSION),
    );

    assert.equal(res.seasonClosed, false);
    assert.equal(res.requiresConfirmation, true);
    assert.match(res.warning, /CANNOT be undone/);
    assert.match(res.warning, /force: true/);

    const state = await scoped.loadSeasonsState();
    assert.equal(state?.seasons.length, 1, "state must be untouched");
    assert.equal(state?.seasons[0]?.endedAt, undefined, "season must not be stamped endedAt");
  });

  it("force: true overrides the guard for a deliberate mid-season rollover", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const now = Date.now();
    await scoped.saveSeasonsState({
      seasons: [{ slug: "s1", startedAt: now - DAY, expectedEndAt: now + 30 * DAY }],
    });

    const res = parseToolResult(
      await makeTool(data).handler({ game: FIXTURE_GAME_NAME, force: true }, SESSION),
    );

    assert.equal(res.seasonClosed, true);
    assert.equal(res.closedSlug, "s1");
    const state = await scoped.loadSeasonsState();
    assert.ok(state?.seasons.find((s) => s.slug === "s1")?.endedAt !== undefined);
  });
});

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createStartNewSeasonTool } from "./startNewSeason.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";

/**
 * Tool-level tests for `start_new_season`. The rollover MECHANICS (continuation
 * inheritance, categories reset, endedAt re-stamp no-op) are covered at the
 * helper level in `../reveal/rollover.test.ts`; this file covers the tool's
 * own behavior: it closes the current season, honors a queued continuation, and
 * degrades cleanly when there is no current season or seasons aren't initialized.
 */

const SESSION = { sessionId: "test" };
const DAY = 86_400_000;

function makeTool(data: ReturnType<typeof createInMemoryDataLayer>) {
  return createStartNewSeasonTool(data, fixtureGetGames);
}

describe("start_new_season", () => {
  it("closes the current season and creates a continuation", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const now = Date.now();
    await scoped.saveSeasonsState({
      seasons: [{ slug: "s1", startedAt: now - DAY, expectedEndAt: now + 60_000 }],
    });

    const res = parseToolResult(await makeTool(data).handler({ game: FIXTURE_GAME_NAME }, SESSION));

    assert.equal(res.seasonClosed, true);
    assert.equal(res.closedSlug, "s1");
    assert.ok(res.newSeasonStarted, "a continuation should be created");

    const state = await scoped.loadSeasonsState();
    const s1 = state?.seasons.find((s) => s.slug === "s1");
    assert.ok(s1?.endedAt !== undefined, "s1 should be stamped endedAt");
    assert.equal(state?.seasons.length, 2);
  });

  it("honors an already-queued future continuation without duplicating it", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const now = Date.now();
    await scoped.saveSeasonsState({
      seasons: [
        { slug: "s1", startedAt: now - DAY, expectedEndAt: now + 60_000 },
        { slug: "s2-staged", startedAt: now + DAY, expectedEndAt: now + 30 * DAY },
      ],
    });

    const res = parseToolResult(await makeTool(data).handler({ game: FIXTURE_GAME_NAME }, SESSION));

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
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const now = Date.now();
    await scoped.saveSeasonsState({
      seasons: [
        { slug: "s0", startedAt: now - 2 * DAY, expectedEndAt: now - DAY, endedAt: now - DAY },
      ],
    });

    const res = parseToolResult(await makeTool(data).handler({ game: FIXTURE_GAME_NAME }, SESSION));

    assert.equal(res.seasonClosed, false);
    const state = await scoped.loadSeasonsState();
    assert.equal(state?.seasons.length, 1, "state is untouched");
  });

  it("errors when seasons are not initialized", async () => {
    const data = createInMemoryDataLayer();
    const out = await makeTool(data).handler({ game: FIXTURE_GAME_NAME }, SESSION);
    assert.ok(out.isError);
  });
});

import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { createEndSeasonTool } from "./endSeason.js";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  FIXTURE_GAMES,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { loadTriviaConfig } from "../../core/configBridge.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaGame } from "../../core/configTypes.js";
import type { TriviaQuestion } from "../../core/types.js";

/**
 * Tool-level tests for `end_season`. The rollover MECHANICS (continuation
 * inheritance, categories reset, endedAt re-stamp no-op) are covered at the
 * helper level in `../reveal/rollover.test.ts`; this file covers the tool's
 * own behavior: the last-fire confirmation guard, force override, closing the
 * current season, honoring a queued continuation, degrading cleanly when
 * there is no current season or seasons aren't initialized, and the
 * `disableAfterRound` wind-down (season branch, seasonless branch, replay).
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

const WIND_DOWN_GAMES: readonly TriviaGame[] = [{ ...FIXTURE_GAMES[0], disableAfterRound: true }];
const windDownGetGames = () => WIND_DOWN_GAMES;

function makeTool(data: FakeTriviaDataLayer, getGames = fixtureGetGames) {
  return createEndSeasonTool(data, getGames);
}

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q",
    category: "C",
    statement: "stmt",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    ...overrides,
  };
}

describe("end_season", () => {
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
    assert.equal(res.gameDisabled, undefined);

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
    assert.equal(res.gameDisabled, undefined, "no wind-down without the flag");
    const state = await scoped.loadSeasonsState();
    assert.ok(state?.seasons.find((s) => s.slug === "s1")?.endedAt !== undefined);
  });

  describe("disableAfterRound wind-down", () => {
    it("season branch: closes the season, creates NO continuation, and disables the game", async () => {
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: WIND_DOWN_GAMES.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      await scoped.saveSeasonsState({
        seasons: [{ slug: "s1", startedAt: now - DAY, expectedEndAt: now + 60_000 }],
      });

      const res = parseToolResult(
        await makeTool(data, windDownGetGames).handler(
          { game: FIXTURE_GAME_NAME, force: undefined },
          SESSION,
        ),
      );

      assert.equal(res.seasonClosed, true);
      assert.equal(res.closedSlug, "s1");
      assert.equal(res.gameDisabled, true);
      assert.equal(res.newSeasonStarted, undefined, "no successor on wind-down");
      assert.match(res.message, /re-enable/i);

      const state = await scoped.loadSeasonsState();
      assert.equal(state?.seasons.length, 1, "no continuation season appended");
      assert.ok(state?.seasons[0]?.endedAt !== undefined, "season still stamped endedAt");
      const persisted = loadTriviaConfig()?.games?.find((g) => g.name === FIXTURE_GAME_NAME);
      assert.equal(persisted?.enabled, false, "enabled: false persisted to config");
      assert.equal(persisted?.disableAfterRound, true, "flag is standing — not cleared");
    });

    it("force: true on a flagged game closes early AND disables it", async () => {
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: WIND_DOWN_GAMES.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      await scoped.saveSeasonsState({
        seasons: [{ slug: "s1", startedAt: now - DAY, expectedEndAt: now + 30 * DAY }],
      });

      const res = parseToolResult(
        await makeTool(data, windDownGetGames).handler(
          { game: FIXTURE_GAME_NAME, force: true },
          SESSION,
        ),
      );

      assert.equal(res.seasonClosed, true);
      assert.equal(res.gameDisabled, true);
      const persisted = loadTriviaConfig()?.games?.find((g) => g.name === FIXTURE_GAME_NAME);
      assert.equal(persisted?.enabled, false);
    });

    it("seasonless branch: winds down when the board is cleared", async () => {
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: WIND_DOWN_GAMES.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      // Board cleared: every posted question is processed.
      await scoped.saveQuestion(
        makeQuestion({ id: "q1", postedAt: now - DAY, processedAt: now - DAY + 1000 }),
      );

      const res = parseToolResult(
        await makeTool(data, windDownGetGames).handler(
          { game: FIXTURE_GAME_NAME, force: undefined },
          SESSION,
        ),
      );

      assert.equal(res.seasonClosed, false, "no season existed to close");
      assert.equal(res.gameDisabled, true);
      const persisted = loadTriviaConfig()?.games?.find((g) => g.name === FIXTURE_GAME_NAME);
      assert.equal(persisted?.enabled, false);
    });

    it("seasonless branch: a timeline gap counts as no active season", async () => {
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: WIND_DOWN_GAMES.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      await scoped.saveSeasonsState({
        seasons: [
          { slug: "s0", startedAt: now - 2 * DAY, expectedEndAt: now - DAY, endedAt: now - DAY },
        ],
      });

      const res = parseToolResult(
        await makeTool(data, windDownGetGames).handler(
          { game: FIXTURE_GAME_NAME, force: undefined },
          SESSION,
        ),
      );

      assert.equal(res.gameDisabled, true);
      const persisted = loadTriviaConfig()?.games?.find((g) => g.name === FIXTURE_GAME_NAME);
      assert.equal(persisted?.enabled, false);
    });

    it("gap with a QUEUED future season never winds down (even with force)", async () => {
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: WIND_DOWN_GAMES.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      await scoped.saveSeasonsState({
        seasons: [
          { slug: "s0", startedAt: now - 2 * DAY, expectedEndAt: now - DAY, endedAt: now - DAY },
          { slug: "s1-staged", startedAt: now + DAY, expectedEndAt: now + 30 * DAY },
        ],
      });

      for (const force of [undefined, true]) {
        const res = parseToolResult(
          await makeTool(data, windDownGetGames).handler(
            { game: FIXTURE_GAME_NAME, force },
            SESSION,
          ),
        );
        assert.equal(res.gameDisabled, undefined);
        assert.match(res.message, /queued to start/);
      }
      const persisted = loadTriviaConfig()?.games?.find((g) => g.name === FIXTURE_GAME_NAME);
      assert.equal(persisted?.enabled, true, "config untouched — still enabled");
    });

    it("seasonless branch: refuses while posted questions are unrevealed", async () => {
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: WIND_DOWN_GAMES.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      await scoped.saveQuestion(makeQuestion({ id: "q1", postedAt: now - 1000 }));

      const out = await makeTool(data, windDownGetGames).handler(
        { game: FIXTURE_GAME_NAME, force: undefined },
        SESSION,
      );

      assert.ok(out.isError, "mid-board wind-down must refuse");
      const persisted = loadTriviaConfig()?.games?.find((g) => g.name === FIXTURE_GAME_NAME);
      assert.equal(persisted?.enabled, true, "config untouched — still enabled");
    });

    it("seasonless branch: force bypasses ONLY the board-cleared check", async () => {
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: WIND_DOWN_GAMES.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      await scoped.saveQuestion(makeQuestion({ id: "q1", postedAt: now - 1000 }));

      const res = parseToolResult(
        await makeTool(data, windDownGetGames).handler(
          { game: FIXTURE_GAME_NAME, force: true },
          SESSION,
        ),
      );

      assert.equal(res.gameDisabled, true);
      const persisted = loadTriviaConfig()?.games?.find((g) => g.name === FIXTURE_GAME_NAME);
      assert.equal(persisted?.enabled, false);
    });

    it("seasonless game WITHOUT the flag keeps the legacy no-current-season response", async () => {
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
      assert.match(res.message, /No current season/);
      assert.equal(res.gameDisabled, undefined);
    });

    it("replay: an already-wound-down game is a no-op success", async () => {
      const disabledGames: readonly TriviaGame[] = [
        { ...FIXTURE_GAMES[0], enabled: false, disableAfterRound: true },
      ];
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: disabledGames.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      await scoped.saveSeasonsState({
        seasons: [
          { slug: "s1", startedAt: now - DAY, expectedEndAt: now + 60_000, endedAt: now - 1000 },
        ],
      });

      const res = parseToolResult(
        await makeTool(data, () => disabledGames).handler(
          { game: FIXTURE_GAME_NAME, force: undefined },
          SESSION,
        ),
      );

      assert.equal(res.alreadyWoundDown, true);
      assert.equal(res.seasonClosed, true);
      assert.equal(res.gameDisabled, true);
      const state = await scoped.loadSeasonsState();
      assert.equal(state?.seasons.length, 1, "no file modified");
    });

    it("replay: wound-down with NO seasons timeline is also a no-op success", async () => {
      const disabledGames: readonly TriviaGame[] = [
        { ...FIXTURE_GAMES[0], enabled: false, disableAfterRound: true },
      ];
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: disabledGames.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);

      const res = parseToolResult(
        await makeTool(data, () => disabledGames).handler(
          { game: FIXTURE_GAME_NAME, force: undefined },
          SESSION,
        ),
      );

      assert.equal(res.alreadyWoundDown, true);
    });

    it("a disabled game WITHOUT the flag still refuses", async () => {
      const disabledGames: readonly TriviaGame[] = [{ ...FIXTURE_GAMES[0], enabled: false }];
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: disabledGames.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);

      const out = await makeTool(data, () => disabledGames).handler(
        { game: FIXTURE_GAME_NAME, force: undefined },
        SESSION,
      );

      assert.ok(out.isError);
    });

    it("teamsStamp is written on the wind-down close when teams mode is on", async () => {
      const teamsGames: readonly TriviaGame[] = [
        {
          ...FIXTURE_GAMES[0],
          disableAfterRound: true,
          teamsEnabled: true,
          teams: [{ name: "Blue", userIds: ["U9"] }],
        },
      ];
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: teamsGames.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      await scoped.saveSeasonsState({
        seasons: [{ slug: "s1", startedAt: now - DAY, expectedEndAt: now + 60_000 }],
      });

      const res = parseToolResult(
        await makeTool(data, () => teamsGames).handler(
          { game: FIXTURE_GAME_NAME, force: undefined },
          SESSION,
        ),
      );

      assert.equal(res.gameDisabled, true);
      const state = await scoped.loadSeasonsState();
      const closed = state?.seasons.find((s) => s.slug === "s1");
      assert.ok(closed?.endedAt !== undefined);
      assert.deepEqual(
        closed?.teamsStamp?.teams,
        [{ name: "Blue", userIds: ["U9"] }],
        "the wind-down close stamps the effective roster like any other close",
      );
    });

    it("crash between endedAt and disable converges on re-run", async () => {
      // Simulate the crashed interleaving: season already closed (endedAt stamped)
      // but the game is still enabled — the re-run must complete the disable.
      const { sdk } = createFakeSdk();
      primeTriviaConfig(sdk, { games: WIND_DOWN_GAMES.map((g) => ({ ...g })) });
      const { dataLayer: data } = createTriviaDataLayer(sdk);
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const now = Date.now();
      await scoped.saveSeasonsState({
        seasons: [
          { slug: "s1", startedAt: now - DAY, expectedEndAt: now - 1000, endedAt: now - 1000 },
        ],
      });

      const res = parseToolResult(
        await makeTool(data, windDownGetGames).handler(
          { game: FIXTURE_GAME_NAME, force: undefined },
          SESSION,
        ),
      );

      assert.equal(res.gameDisabled, true);
      const state = await scoped.loadSeasonsState();
      assert.equal(state?.seasons.length, 1, "no re-stamp, no continuation");
      const persisted = loadTriviaConfig()?.games?.find((g) => g.name === FIXTURE_GAME_NAME);
      assert.equal(persisted?.enabled, false, "the disable completed");
    });
  });
});

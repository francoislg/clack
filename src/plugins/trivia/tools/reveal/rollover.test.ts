import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { pickSeasonMvp, deriveNextMonthSlug, applySeasonRollover } from "./rollover.js";
import type { LeaderboardEntry } from "../../domain/computeLeaderboard.js";
import type { SeasonsState } from "../../core/types.js";

/**
 * Defaults model a UNIFORM 1-point history: points mirror the correct counts unless a
 * case overrides them. That keeps the count-era expectations below meaningful as
 * legacy-equivalence checks, and lets the weighted cases state points explicitly.
 */
function entry(
  overrides: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "userId">,
): LeaderboardEntry {
  const totalCorrect = overrides.totalCorrect ?? 0;
  const base: LeaderboardEntry = {
    userId: overrides.userId,
    displayName: overrides.userId,
    totalCorrect,
    totalAnswered: 0,
    totalPoints: totalCorrect,
    accuracy: 0,
  };
  const merged: LeaderboardEntry = { ...base, ...overrides };
  if (overrides.totalPoints === undefined) merged.totalPoints = merged.totalCorrect;
  if (overrides.currentSeasonPoints === undefined && merged.currentSeasonCorrect !== undefined) {
    merged.currentSeasonPoints = merged.currentSeasonCorrect;
  }
  return merged;
}

describe("pickSeasonMvp", () => {
  it("returns undefined when no entry has currentSeasonCorrect > 0", () => {
    const board: LeaderboardEntry[] = [
      entry({ userId: "U1", currentSeasonCorrect: 0, currentSeasonAnswered: 0, totalCorrect: 50 }),
      entry({ userId: "U2", currentSeasonCorrect: 0, currentSeasonAnswered: 0, totalCorrect: 20 }),
    ];
    assert.equal(pickSeasonMvp(board), undefined);
  });

  it("returns undefined for an empty leaderboard", () => {
    assert.equal(pickSeasonMvp([]), undefined);
  });

  it("picks the entry with the highest currentSeasonCorrect", () => {
    const board: LeaderboardEntry[] = [
      entry({ userId: "U1", displayName: "Alice", currentSeasonCorrect: 5, totalCorrect: 5 }),
      entry({ userId: "U2", displayName: "Bob", currentSeasonCorrect: 10, totalCorrect: 10 }),
      entry({ userId: "U3", displayName: "Carol", currentSeasonCorrect: 7, totalCorrect: 100 }),
    ];
    const mvp = pickSeasonMvp(board);
    assert.equal(mvp?.userId, "U2");
    assert.equal(mvp?.displayName, "Bob");
    assert.equal(mvp?.currentSeasonCorrect, 10);
  });

  it("ties on currentSeasonCorrect resolved by totalCorrect descending", () => {
    const board: LeaderboardEntry[] = [
      entry({ userId: "U1", displayName: "Alice", currentSeasonCorrect: 5, totalCorrect: 20 }),
      entry({ userId: "U2", displayName: "Bob", currentSeasonCorrect: 5, totalCorrect: 50 }),
    ];
    assert.equal(pickSeasonMvp(board)?.userId, "U2");
  });

  it("skips entries with undefined currentSeasonCorrect", () => {
    const board: LeaderboardEntry[] = [
      entry({ userId: "U1", currentSeasonCorrect: 3 }),
      entry({ userId: "U2" }), // no currentSeasonCorrect field
    ];
    assert.equal(pickSeasonMvp(board)?.userId, "U1");
  });

  it("picks by points, not by correct count, on a weighted season", () => {
    const board: LeaderboardEntry[] = [
      entry({
        userId: "U1",
        displayName: "Alice",
        currentSeasonCorrect: 3,
        currentSeasonPoints: 5,
        totalCorrect: 3,
        totalPoints: 5,
      }),
      entry({
        userId: "U2",
        displayName: "Bob",
        currentSeasonCorrect: 4,
        currentSeasonPoints: 4,
        totalCorrect: 4,
        totalPoints: 4,
      }),
    ];
    const mvp = pickSeasonMvp(board);
    assert.equal(mvp?.userId, "U1", "5 points beats 4 despite one fewer correct");
    assert.equal(mvp?.currentSeasonPoints, 5);
    assert.equal(mvp?.currentSeasonCorrect, 3, "the count rides along for context");
  });

  it("ties on points resolved by all-time totalPoints descending", () => {
    const board: LeaderboardEntry[] = [
      entry({ userId: "U1", currentSeasonPoints: 6, currentSeasonCorrect: 3, totalPoints: 20 }),
      entry({ userId: "U2", currentSeasonPoints: 6, currentSeasonCorrect: 6, totalPoints: 50 }),
    ];
    assert.equal(pickSeasonMvp(board)?.userId, "U2");
  });
});

describe("deriveNextMonthSlug", () => {
  it("derives the next calendar month's slug from a mid-month timestamp", () => {
    const may15 = Date.UTC(2026, 4, 15, 12, 0, 0, 0); // 2026-05-15
    const { slug, expectedEndAt } = deriveNextMonthSlug(may15);
    assert.equal(slug, "season-2026-06");
    // June 2026's last instant
    const expected = Date.UTC(2026, 5, 30, 23, 59, 59, 999);
    assert.equal(expectedEndAt, expected);
  });

  it("rolls into the next year when input is December", () => {
    const dec = Date.UTC(2026, 11, 31, 10, 0, 0, 0);
    const { slug, expectedEndAt } = deriveNextMonthSlug(dec);
    assert.equal(slug, "season-2027-01");
    assert.equal(expectedEndAt, Date.UTC(2027, 0, 31, 23, 59, 59, 999));
  });

  it("pads single-digit months to two digits", () => {
    const apr = Date.UTC(2026, 3, 10, 0, 0, 0, 0);
    const { slug } = deriveNextMonthSlug(apr);
    assert.equal(slug, "season-2026-05");
  });
});

describe("applySeasonRollover", () => {
  function makeActiveState(now: number, currentSlug: string): SeasonsState {
    return {
      seasons: [
        {
          slug: currentSlug,
          startedAt: now - 30 * 24 * 60 * 60 * 1000,
          expectedEndAt: now + 1, // about to end
          categories: ["Science"],
        },
      ],
    };
  }

  it("stamps endedAt on the current season when not already set", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    const out = applySeasonRollover(state, "season-2026-05", now);
    assert.equal(out.seasonClosed, true);
    assert.equal(state.seasons[0].endedAt, now);
  });

  it("is idempotent — does not re-stamp endedAt if already set", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    state.seasons[0].endedAt = now - 1000;
    const out = applySeasonRollover(state, "season-2026-05", now);
    assert.equal(out.seasonClosed, false);
    assert.equal(state.seasons[0].endedAt, now - 1000);
  });

  it("appends a continuation season that does NOT inherit season-level categories (resets to cascade)", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    // Closing season has its own themed categories — a one-month deviation
    state.seasons[0].categories = ["Marine Biology", "Cephalopods", "Tides"];
    const out = applySeasonRollover(state, "season-2026-05", now);
    assert.ok(out.newSeasonStarted);
    assert.equal(out.newSeasonStarted?.slug, "season-2026-06");
    assert.equal(state.seasons.length, 2);
    // The themed pool is dropped: continuation omits `categories` so it resolves
    // via the cascade (game → global) rather than re-baking the theme forward.
    assert.equal(state.seasons[1].categories, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(state.seasons[1], "categories"));
    assert.equal(state.seasons[1].startedAt, now);
  });

  it("continuation inherits answersFormat from closing season", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    state.seasons[0].answersFormat = { boolean: 0, choice: 1, freeform: 0 };
    applySeasonRollover(state, "season-2026-05", now);
    assert.deepEqual(state.seasons[1].answersFormat, { boolean: 0, choice: 1, freeform: 0 });
  });

  it("continuation inherits format from closing season (deep-copied)", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    state.seasons[0].format = {
      questions: [
        { label: "GK", answersFormat: { boolean: 1, choice: 0, freeform: 0 } },
        {
          label: "History Choice",
          categories: ["History"],
          answersFormat: { boolean: 0, choice: 1, freeform: 0 },
        },
      ],
    };
    applySeasonRollover(state, "season-2026-05", now);
    assert.equal(state.seasons[1].format?.questions.length, 2);
    assert.equal(state.seasons[1].format?.questions[0].label, "GK");
    assert.deepEqual(state.seasons[1].format?.questions[1].categories, ["History"]);

    // Verify deep copy: mutating the new season's format should NOT affect the closing one
    if (state.seasons[1].format !== undefined) {
      state.seasons[1].format.questions[0].label = "MUTATED";
    }
    assert.equal(state.seasons[0].format?.questions[0].label, "GK");
  });

  it("drops season-level categories but PRESERVES slot-level categories inside format", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    // Closing season has BOTH a themed season-level pool AND a format whose slot
    // carries its own categories.
    state.seasons[0].categories = ["Marine Biology", "Cephalopods"];
    state.seasons[0].format = {
      questions: [{ label: "GK" }, { label: "Science", categories: ["Science"] }],
    };
    applySeasonRollover(state, "season-2026-05", now);
    const continuation = state.seasons[1];
    // Season-level themed pool is dropped (resolves via cascade)...
    assert.equal(continuation.categories, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(continuation, "categories"));
    // ...but the slot-level pool is structural and survives with the format.
    assert.deepEqual(continuation.format?.questions[1].categories, ["Science"]);
  });

  it("continuation: absent fields stay absent (no answersFormat, no format on closing → none on continuation)", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    // Closing season has no answersFormat and no format
    applySeasonRollover(state, "season-2026-05", now);
    assert.equal(state.seasons[1].answersFormat, undefined);
    assert.equal(state.seasons[1].format, undefined);
    // Season-level categories are NOT carried forward either — the continuation
    // resolves its pool via the cascade.
    assert.equal(state.seasons[1].categories, undefined);
  });

  it("does NOT append a continuation when a future season is already queued", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    state.seasons.push({
      slug: "marine-fall",
      startedAt: now + 1000,
      expectedEndAt: now + 30 * 24 * 60 * 60 * 1000,
      categories: ["Cephalopods"],
    });
    const out = applySeasonRollover(state, "season-2026-05", now);
    assert.equal(state.seasons.length, 2);
    assert.equal(out.newSeasonStarted, undefined);
  });

  it("staged future season is NOT modified during rollover", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    state.seasons[0].format = { questions: [{ label: "X" }] };
    const stagedFormat = { questions: [{ label: "STAGED" }] };
    state.seasons.push({
      slug: "marine-fall",
      startedAt: now + 1000,
      expectedEndAt: now + 30 * 24 * 60 * 60 * 1000,
      categories: ["Cephalopods"],
      format: stagedFormat,
    });
    applySeasonRollover(state, "season-2026-05", now);
    // Staged season retains its OWN format, not the closing one's
    assert.equal(state.seasons[1].format?.questions[0].label, "STAGED");
  });

  it("when no continuation overlap is possible, both seasonClosed and newSeasonStarted are true on first run", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    const out = applySeasonRollover(state, "season-2026-05", now);
    assert.equal(out.seasonClosed, true);
    assert.ok(out.newSeasonStarted);
  });

  it("auto-continuation season does NOT inherit `theme` from the closing season", () => {
    const now = Date.UTC(2026, 9, 31, 12, 0, 0, 0); // Oct 31
    const state: SeasonsState = {
      seasons: [
        {
          slug: "season-2026-10",
          startedAt: now - 30 * 24 * 60 * 60 * 1000,
          expectedEndAt: now + 1,
          categories: ["Horror Movies", "Folklore"],
          theme: "Halloween Spooktacular",
        },
      ],
    };
    const out = applySeasonRollover(state, "season-2026-10", now);
    assert.equal(out.seasonClosed, true);
    assert.ok(out.newSeasonStarted);
    const continuation = state.seasons[1];
    assert.equal(continuation.slug, "season-2026-11");
    assert.equal(continuation.theme, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(continuation, "theme"));
    // categories are dropped alongside theme — both are thematic, not structural
    assert.equal(continuation.categories, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(continuation, "categories"));
  });
});

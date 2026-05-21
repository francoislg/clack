import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickSeasonMvp, deriveNextMonthSlug, applySeasonRollover } from "./rollover.js";
import type { LeaderboardEntry } from "../../domain/computeLeaderboard.js";
import type { SeasonsState } from "../../core/types.js";

function entry(
  overrides: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "userId">,
): LeaderboardEntry {
  return {
    displayName: overrides.userId,
    totalCorrect: 0,
    totalAnswered: 0,
    accuracy: 0,
    ...overrides,
  } satisfies LeaderboardEntry;
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

  it("appends a continuation season inheriting categories from the closing season", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    // Closing season has its own themed categories — NOT the global baseline
    state.seasons[0].categories = ["Marine Biology", "Cephalopods", "Tides"];
    const out = applySeasonRollover(state, "season-2026-05", now);
    assert.ok(out.newSeasonStarted);
    assert.equal(out.newSeasonStarted?.slug, "season-2026-06");
    assert.equal(state.seasons.length, 2);
    assert.deepEqual(state.seasons[1].categories, ["Marine Biology", "Cephalopods", "Tides"]);
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

  it("continuation: absent fields stay absent (no answersFormat, no format on closing → none on continuation)", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0);
    const state = makeActiveState(now, "season-2026-05");
    // Closing season has no answersFormat and no format
    applySeasonRollover(state, "season-2026-05", now);
    assert.equal(state.seasons[1].answersFormat, undefined);
    assert.equal(state.seasons[1].format, undefined);
    // categories ARE still inherited
    assert.deepEqual(state.seasons[1].categories, ["Science"]);
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
    // categories still inherited (sanity)
    assert.deepEqual(continuation.categories, ["Horror Movies", "Folklore"]);
  });
});

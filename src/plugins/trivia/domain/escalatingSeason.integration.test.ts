import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveCascade, AXIS_KEYS } from "./resolveCascade.js";
import { buildCascadeContext } from "./cascadeContext.js";
import { DAY_MS } from "./seasonPhases.js";
import type { SeasonEntry, PhaseSlice } from "../core/types.js";
import type { TriviaGame } from "../core/configTypes.js";

/**
 * The escalating-season use case, end to end at the resolution layer: a season
 * that gets progressively harder as its temporal phases advance, while a pinned
 * "warm-up" slot stays gentle throughout. This wires the real phase-window
 * derivation, `buildCascadeContext`, and `resolveCascade` together over a real
 * season object — no mocks — so it earns the `*.integration.test.ts` suffix.
 *
 * The season runs a warm-up → ramp → gauntlet arc. Slot 0 is a daily warm-up
 * question pinned to an all-easy difficulty at the season-slot tier, which sits
 * ABOVE `seasonPhase`, so the escalation never reaches it. Slots 1 and 2 leave
 * the axis unset, so they follow whichever phase is live.
 */

// A three-slot game format supplies the question count. Its slots set nothing
// on the difficulty axis — the warm-up pin lives on the season (below), which is
// the only slot tier that outranks the phase.
const game: TriviaGame = {
  name: "escalate",
  channel: "C1",
  questionCron: "0 9 * * *",
  revealCron: "0 17 * * *",
  timezone: "UTC",
  format: {
    questions: [{ label: "Daily warm-up" }, {}, {}],
  },
};

// Progressively harder difficultyRatio maps for the three phases. The story is in
// the weights: mostly-easy in the warm-up, a real middle in the ramp, mostly-hard
// in the gauntlet.
const GENTLE = { easy: 8, medium: 2, hard: 0 };
const TOUGHER = { easy: 3, medium: 5, hard: 2 };
const BRUTAL = { easy: 0, medium: 2, hard: 8 };

// The season baseline the slots fall back to when no phase is live. Deliberately
// distinct from every phase value so "phase removed" is unmistakable.
const SEASON_BASELINE = { easy: 4, medium: 4, hard: 2 };

// The warm-up pin: all-easy, forever, immune to the phase arc.
const PINNED_EASY = { easy: 1, medium: 0, hard: 0 };

const WARMUP: PhaseSlice = { slug: "warmup", days: 14, difficultyRatio: { boolean: GENTLE } };
const RAMP: PhaseSlice = { slug: "ramp", days: 14, difficultyRatio: { boolean: TOUGHER } };
const GAUNTLET: PhaseSlice = { slug: "gauntlet", difficultyRatio: { boolean: BRUTAL } };

/**
 * A 60-day season. It carries a season-tier baseline difficultyRatio, pins slot 0
 * to all-easy via a season-slot override (the tier above the phase), and — when
 * `phases` is supplied — runs the warm-up → ramp → gauntlet arc.
 */
function makeSeason(phases?: PhaseSlice[]): SeasonEntry {
  return {
    slug: "escalating",
    startedAt: 0,
    expectedEndAt: 60 * DAY_MS,
    difficultyRatio: { boolean: SEASON_BASELINE },
    slotOverrides: { 0: { difficultyRatio: { boolean: PINNED_EASY } } },
    ...(phases !== undefined ? { phases } : {}),
  };
}

// One instant inside each phase window: warm-up [0,14), ramp [14,28), gauntlet [28,60).
const DAY_3 = 3 * DAY_MS; // warm-up
const DAY_20 = 20 * DAY_MS; // ramp
const DAY_40 = 40 * DAY_MS; // gauntlet

/** Resolve the boolean difficultyRatio for `(slot, at)` against `season`. */
function ratioAt(season: SeasonEntry, slot: number, at: number) {
  const ctx = buildCascadeContext(season, game, slot, null, { at });
  return resolveCascade("difficultyRatio", ctx, { answersFormat: "boolean" });
}

describe("escalating season — phases drive difficulty while a pinned warm-up slot holds", () => {
  it("the warm-up slot stays gentle while slots 1 & 2 escalate warm-up → ramp → gauntlet", () => {
    const season = makeSeason([WARMUP, RAMP, GAUNTLET]);

    // Slot 0 is pinned at the season-slot tier, so all three instants — one per
    // phase — resolve to the same all-easy map. The phase never moves it.
    for (const at of [DAY_3, DAY_20, DAY_40]) {
      const slot0 = ratioAt(season, 0, at);
      assert.equal(slot0.tier, "seasonSlot");
      assert.deepEqual(slot0.value, PINNED_EASY);
    }

    // Slots 1 and 2 leave difficultyRatio unset, so they inherit the live phase:
    // gentle in the warm-up, tougher on the ramp, brutal in the gauntlet.
    for (const slot of [1, 2]) {
      const warmup = ratioAt(season, slot, DAY_3);
      const ramp = ratioAt(season, slot, DAY_20);
      const gauntlet = ratioAt(season, slot, DAY_40);

      assert.equal(warmup.tier, "seasonPhase");
      assert.equal(ramp.tier, "seasonPhase");
      assert.equal(gauntlet.tier, "seasonPhase");

      assert.deepEqual(warmup.value, GENTLE);
      assert.deepEqual(ramp.value, TOUGHER);
      assert.deepEqual(gauntlet.value, BRUTAL);

      // The escalation actually happened: three instants, three different ratios.
      assert.notDeepEqual(warmup.value, ramp.value);
      assert.notDeepEqual(ramp.value, gauntlet.value);
      assert.notDeepEqual(warmup.value, gauntlet.value);
    }
  });

  it("removing the phases collapses the escalating slots to the season baseline, with no phase tier", () => {
    const season = makeSeason(undefined); // same season, phases stripped

    for (const at of [DAY_3, DAY_20, DAY_40]) {
      // The warm-up pin is untouched — it never depended on the phases.
      const slot0 = ratioAt(season, 0, at);
      assert.equal(slot0.tier, "seasonSlot");
      assert.deepEqual(slot0.value, PINNED_EASY);

      // Slots 1 and 2 now resolve to the season baseline, identically at every
      // instant (with no phases there is nothing time-dependent left).
      for (const slot of [1, 2]) {
        const r = ratioAt(season, slot, at);
        assert.equal(r.tier, "season");
        assert.deepEqual(r.value, SEASON_BASELINE);
      }
    }

    // And with the phases gone, no axis on any slot can resolve at the phase tier.
    for (const slot of [0, 1, 2]) {
      const ctx = buildCascadeContext(season, game, slot, null, { at: DAY_20 });
      assert.equal(ctx.seasonPhase, null);
      for (const key of AXIS_KEYS) {
        const r = resolveCascade(key, ctx, { answersFormat: "boolean" });
        assert.notEqual(r.tier, "seasonPhase");
      }
    }
  });
});

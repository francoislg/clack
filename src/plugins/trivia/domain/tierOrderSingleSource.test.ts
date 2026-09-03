import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CascadeAxes, CascadeContext, ConcreteTier } from "../core/cascadeAxes.js";
import { CASCADE_TIER_ORDER, tierObjects } from "../core/cascadeAxes.js";
import type { SeasonEntry, PhaseSlice } from "../core/types.js";
import type { TriviaGame } from "../core/configTypes.js";
import { resolveDifficultyRanges } from "./difficulty.js";

/**
 * Guard: `CASCADE_TIER_ORDER` is the ONLY enumeration of cascade tiers. `tierObjects`
 * keys off it, and the difficulty resolvers derive their broadest-first walk from it, so
 * a newly-added tier cannot be silently skipped by a stale hand-written list.
 */
const DOMAIN_DIR = dirname(fileURLToPath(import.meta.url));

/** Build a `CascadeContext` from a partial tier→axes map (each tier a distinguishable sentinel). */
function ctxFrom(tiers: Partial<Record<ConcreteTier, CascadeAxes>>): CascadeContext {
  // `season`/`game`/`seasonPhase` carry required non-axis fields, so their tier objects
  // need a cast; the slot/config tiers add only optional fields and are directly assignable.
  const season = tiers.season ?? null;
  const game = tiers.game ?? null;
  const seasonPhase = tiers.seasonPhase ?? null;
  return {
    seasonSlot: tiers.seasonSlot ?? null,
    seasonPhase: seasonPhase as PhaseSlice | null,
    gameSlot: tiers.gameSlot ?? null,
    season: season as SeasonEntry | null,
    game: game as TriviaGame | null,
    config: tiers.workspace ?? null,
    slotIndex: 0,
  };
}

describe("tier-order single source guard", () => {
  it("tierObjects has exactly one entry per CASCADE_TIER_ORDER tier and no extras", () => {
    const keys = Object.keys(tierObjects(ctxFrom({}))).sort();
    expect(keys).toEqual([...CASCADE_TIER_ORDER].sort());
  });

  it("the difficulty broadest-first walk is exactly [...CASCADE_TIER_ORDER].reverse()", () => {
    // Each tier's `difficulty.boolean.easy` sentinel encodes its precedence index. The
    // per-field merge applies broadest-first, so the highest-precedence PRESENT tier wins.
    const sentinel = (i: number): CascadeAxes => ({ difficulty: { boolean: { easy: [i, i] } } });

    // For each start index, only tier[start] and every lower-precedence tier are present.
    // tier[start] must win — walking this over all starts proves precedence order equals
    // CASCADE_TIER_ORDER, hence the broadest-first walk is exactly its reverse.
    for (let start = 0; start < CASCADE_TIER_ORDER.length; start++) {
      const tiers: Partial<Record<ConcreteTier, CascadeAxes>> = {};
      for (let i = start; i < CASCADE_TIER_ORDER.length; i++) {
        tiers[CASCADE_TIER_ORDER[i]] = sentinel(i);
      }
      const resolved = resolveDifficultyRanges(ctxFrom(tiers), "boolean");
      expect(resolved.easy).toEqual([start, start]);
    }
  });

  it("difficulty.ts derives its tier walk from CASCADE_TIER_ORDER, not a hand-written array", () => {
    const text = readFileSync(join(DOMAIN_DIR, "difficulty.ts"), "utf8");
    expect(text).toContain("CASCADE_TIER_ORDER");
    expect(text).toContain("tierObjects");
    // Guards against a hand-written tier array creeping back into difficulty.ts.
    expect(text).not.toMatch(/\[[^\]]*ctx\.\w+[^\]]*,[^\]]*ctx\.\w+[^\]]*\]/);
  });
});

import { describe, it, expect } from "vitest";
import { buildCascadeContext } from "./cascadeContext.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaGame } from "../core/configTypes.js";

const baseGame: TriviaGame = {
  name: "g",
  channel: "C1",
  questionCron: "0 9 * * *",
  revealCron: "0 17 * * *",
  timezone: "UTC",
};

function season(overrides: Partial<SeasonEntry>): SeasonEntry {
  return { slug: "s1", startedAt: 0, expectedEndAt: 1, ...overrides };
}

describe("buildCascadeContext", () => {
  it("slot reads the season format slot when the season has a format", () => {
    const s = season({ format: { questions: [{ label: "S0" }, { label: "S1" }] } });
    const game: TriviaGame = { ...baseGame, format: { questions: [{ label: "G0" }] } };
    const ctx = buildCascadeContext(s, game, 1, null);
    expect(ctx.slot).toEqual({ label: "S1" });
    expect(ctx.slotIndex).toBe(1);
  });

  it("slot reads the GAME format slot when the game has a format and no season format", () => {
    // This is the intended behavior change: game-format slots are honored.
    const game: TriviaGame = {
      ...baseGame,
      format: {
        questions: [{ label: "G0", answersFormat: { boolean: 0, choice: 1, freeform: 0 } }],
      },
    };
    const ctx = buildCascadeContext(null, game, 0, null);
    expect(ctx.slot).toEqual({
      label: "G0",
      answersFormat: { boolean: 0, choice: 1, freeform: 0 },
    });
  });

  it("game-format slot is honored even when a season exists but has no format", () => {
    const s = season({}); // active season, no format
    const game: TriviaGame = { ...baseGame, format: { questions: [{ label: "G0" }] } };
    const ctx = buildCascadeContext(s, game, 0, null);
    expect(ctx.slot).toEqual({ label: "G0" });
  });

  it("slot is null when no format is active", () => {
    expect(buildCascadeContext(null, baseGame, 0, null).slot).toBeNull();
    expect(buildCascadeContext(null, baseGame, null, null).slot).toBeNull();
  });

  it("slot is null for an out-of-range index", () => {
    const game: TriviaGame = { ...baseGame, format: { questions: [{ label: "G0" }] } };
    expect(buildCascadeContext(null, game, 5, null).slot).toBeNull();
  });
});

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
  it("gameSlot reads the game-format slot, independent of any season", () => {
    const game: TriviaGame = {
      ...baseGame,
      format: {
        questions: [{ label: "G0", answersFormat: { boolean: 0, choice: 1, freeform: 0 } }],
      },
    };
    const ctx = buildCascadeContext(null, game, 0, null);
    expect(ctx.gameSlot).toEqual({
      label: "G0",
      answersFormat: { boolean: 0, choice: 1, freeform: 0 },
    });
    expect(ctx.slotIndex).toBe(0);
  });

  it("gameSlot is honored even when a season exists but has no format/overrides", () => {
    const s = season({});
    const game: TriviaGame = { ...baseGame, format: { questions: [{ label: "G0" }] } };
    const ctx = buildCascadeContext(s, game, 0, null);
    expect(ctx.gameSlot).toEqual({ label: "G0" });
    expect(ctx.seasonSlot).toBeNull();
  });

  it("seasonSlot reads season.slotOverrides[index] when present (count-decoupled)", () => {
    const s = season({ slotOverrides: { 1: { promptMedium: { text: 0, image: 1 } } } });
    const game: TriviaGame = {
      ...baseGame,
      format: { questions: [{ label: "G0" }, { label: "G1" }] },
    };
    const ctx = buildCascadeContext(s, game, 1, null);
    expect(ctx.seasonSlot).toEqual({ promptMedium: { text: 0, image: 1 } });
    expect(ctx.gameSlot).toEqual({ label: "G1" });
  });

  it("seasonSlot reads the season-format slot when the season declares its own format", () => {
    const s = season({ format: { questions: [{ label: "S0" }, { label: "S1" }] } });
    const game: TriviaGame = { ...baseGame, format: { questions: [{ label: "G0" }] } };
    const ctx = buildCascadeContext(s, game, 1, null);
    expect(ctx.seasonSlot).toEqual({ label: "S1" });
    expect(ctx.gameSlot).toBeNull(); // game format only has index 0
  });

  it("slotOverrides wins over season.format as the seasonSlot source", () => {
    // The parser enforces mutual exclusivity, but the builder reads slotOverrides first.
    const s = season({
      slotOverrides: { 0: { label: "OVR" } },
      format: { questions: [{ label: "S0" }] },
    });
    const ctx = buildCascadeContext(s, baseGame, 0, null);
    expect(ctx.seasonSlot).toEqual({ label: "OVR" });
  });

  it("both slot tiers are null when no format/override is active", () => {
    const ctx = buildCascadeContext(null, baseGame, 0, null);
    expect(ctx.gameSlot).toBeNull();
    expect(ctx.seasonSlot).toBeNull();
    const ctxNoIndex = buildCascadeContext(null, baseGame, null, null);
    expect(ctxNoIndex.gameSlot).toBeNull();
    expect(ctxNoIndex.seasonSlot).toBeNull();
  });

  it("gameSlot is null for an out-of-range index", () => {
    const game: TriviaGame = { ...baseGame, format: { questions: [{ label: "G0" }] } };
    expect(buildCascadeContext(null, game, 5, null).gameSlot).toBeNull();
  });

  it("seasonSlot resolves from slotOverrides even when the game format lacks that index", () => {
    const s = season({ slotOverrides: { 5: { label: "OVR" } } });
    const game: TriviaGame = { ...baseGame, format: { questions: [{ label: "G0" }] } };
    const ctx = buildCascadeContext(s, game, 5, null);
    expect(ctx.seasonSlot).toEqual({ label: "OVR" });
    expect(ctx.gameSlot).toBeNull();
  });
});

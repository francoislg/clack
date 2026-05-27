import { describe, it, expect } from "vitest";
import { resolveInstructions, resolveAdditionalInstructions } from "./instructions.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";

const baseGame: TriviaGame = {
  name: "main",
  channel: "C1",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

const baseSeason: SeasonEntry = {
  slug: "s1",
  startedAt: 0,
  expectedEndAt: 1,
  categories: ["History"],
};

const seasonWithFormat = (slot: SeasonEntry["format"]): SeasonEntry => ({
  ...baseSeason,
  format: slot,
});

describe("resolveInstructions", () => {
  it("returns null when every tier is absent", () => {
    expect(resolveInstructions(null, null, null, null)).toBeNull();
    expect(resolveInstructions(baseSeason, null, baseGame, {})).toBeNull();
  });

  it("workspace value wins as last resort", () => {
    const config: TriviaConfig = { instructions: "Workspace rule." };
    expect(resolveInstructions(null, null, null, config)).toBe("Workspace rule.");
  });

  it("game value wins over workspace", () => {
    const config: TriviaConfig = { instructions: "Workspace rule." };
    const game: TriviaGame = { ...baseGame, instructions: "Game rule." };
    expect(resolveInstructions(null, null, game, config)).toBe("Game rule.");
  });

  it("season value wins over game and workspace", () => {
    const config: TriviaConfig = { instructions: "Workspace rule." };
    const game: TriviaGame = { ...baseGame, instructions: "Game rule." };
    const season: SeasonEntry = { ...baseSeason, instructions: "Season rule." };
    expect(resolveInstructions(season, null, game, config)).toBe("Season rule.");
  });

  it("slot value wins over every other tier", () => {
    const config: TriviaConfig = { instructions: "Workspace rule." };
    const game: TriviaGame = { ...baseGame, instructions: "Game rule." };
    const season = seasonWithFormat({
      questions: [{}, { instructions: "Slot rule." }],
    });
    season.instructions = "Season rule.";
    expect(resolveInstructions(season, 1, game, config)).toBe("Slot rule.");
  });

  it("ignores slot tier when no format is active", () => {
    const season: SeasonEntry = { ...baseSeason, instructions: "Season rule." };
    expect(resolveInstructions(season, 0, null, null)).toBe("Season rule.");
  });

  it("treats whitespace-only as absent at every tier", () => {
    const config: TriviaConfig = { instructions: "   " };
    const game: TriviaGame = { ...baseGame, instructions: "\n\n" };
    const season: SeasonEntry = { ...baseSeason, instructions: "" };
    expect(resolveInstructions(season, null, game, config)).toBeNull();
  });

  it("falls through past empty slot to season", () => {
    const season = seasonWithFormat({ questions: [{ instructions: "   " }] });
    season.instructions = "Season rule.";
    expect(resolveInstructions(season, 0, null, null)).toBe("Season rule.");
  });
});

describe("resolveAdditionalInstructions", () => {
  it("returns null when every tier is absent", () => {
    expect(resolveAdditionalInstructions(null, null, null, null)).toBeNull();
    expect(resolveAdditionalInstructions(baseSeason, null, baseGame, {})).toBeNull();
  });

  it("workspace-only emits a single segment", () => {
    const config: TriviaConfig = { additionalInstructions: "Avoid politics." };
    expect(resolveAdditionalInstructions(null, null, null, config)).toBe(
      "[Workspace] Avoid politics.",
    );
  });

  it("game-only emits a single segment", () => {
    const game: TriviaGame = { ...baseGame, additionalInstructions: "Be concise." };
    expect(resolveAdditionalInstructions(null, null, game, null)).toBe("[Game] Be concise.");
  });

  it("season-only emits a single segment", () => {
    const season: SeasonEntry = { ...baseSeason, additionalInstructions: "Halloween theme." };
    expect(resolveAdditionalInstructions(season, null, null, null)).toBe(
      "[Season] Halloween theme.",
    );
  });

  it("slot-only emits a single segment with the index label", () => {
    const season = seasonWithFormat({
      questions: [{}, { additionalInstructions: "Make it easy." }],
    });
    expect(resolveAdditionalInstructions(season, 1, null, null)).toBe("[Slot 1] Make it easy.");
  });

  it("concatenates all four tiers in workspace → game → season → slot order", () => {
    const config: TriviaConfig = { additionalInstructions: "Avoid politics." };
    const game: TriviaGame = { ...baseGame, additionalInstructions: "Be concise." };
    const season = seasonWithFormat({
      questions: [{}, {}, { additionalInstructions: "Make it easy." }],
    });
    season.additionalInstructions = "Halloween theme.";

    const out = resolveAdditionalInstructions(season, 2, game, config);
    expect(out).toBe(
      [
        "[Workspace] Avoid politics.",
        "[Game] Be concise.",
        "[Season] Halloween theme.",
        "[Slot 2] Make it easy.",
      ].join("\n\n"),
    );
  });

  it("skips absent tiers in the chain", () => {
    const config: TriviaConfig = { additionalInstructions: "Avoid politics." };
    const season = seasonWithFormat({
      questions: [{ additionalInstructions: "Slot 0 says hi." }],
    });
    const out = resolveAdditionalInstructions(season, 0, null, config);
    expect(out).toBe("[Workspace] Avoid politics.\n\n[Slot 0] Slot 0 says hi.");
  });

  it("uses index in label even when slot has a display label", () => {
    const season = seasonWithFormat({
      questions: [{ label: "Quick fire", additionalInstructions: "Stay sharp." }],
    });
    expect(resolveAdditionalInstructions(season, 0, null, null)).toBe("[Slot 0] Stay sharp.");
  });

  it("treats whitespace-only values as absent", () => {
    const config: TriviaConfig = { additionalInstructions: "   " };
    const game: TriviaGame = { ...baseGame, additionalInstructions: "Be concise." };
    const out = resolveAdditionalInstructions(null, null, game, config);
    expect(out).toBe("[Game] Be concise.");
  });

  it("ignores slot tier when no format is active", () => {
    const season: SeasonEntry = { ...baseSeason, additionalInstructions: "Season-only." };
    expect(resolveAdditionalInstructions(season, 0, null, null)).toBe("[Season] Season-only.");
  });
});

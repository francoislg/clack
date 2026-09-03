import { describe, it, expect } from "vitest";
import { resolveCascade, AXIS_KEYS } from "./resolveCascade.js";
import { buildCascadeContext } from "./cascadeContext.js";
import { CASCADE_TIER_ORDER } from "../core/cascadeAxes.js";
import { DAY_MS } from "./seasonPhases.js";
import type { SeasonEntry, PhaseSlice } from "../core/types.js";
import type { TriviaGame, TriviaConfig } from "../core/configTypes.js";

const baseGame: TriviaGame = {
  name: "g",
  channel: "C1",
  questionCron: "0 9 * * *",
  revealCron: "0 17 * * *",
  timezone: "UTC",
};

function season(overrides: Partial<SeasonEntry>): SeasonEntry {
  return { slug: "s1", startedAt: 0, expectedEndAt: 60 * DAY_MS, ...overrides };
}

describe("resolveCascade — seasonPhase tier", () => {
  it("an axis set on the phase and the season resolves to the phase's value at tier seasonPhase", () => {
    const phase: PhaseSlice = { slug: "gauntlet", promptMedium: { text: 5, image: 0 } };
    const s = season({ phases: [phase], promptMedium: { text: 1, image: 0 } });
    const ctx = buildCascadeContext(s, baseGame, null, null, { slug: "gauntlet" });
    const r = resolveCascade("promptMedium", ctx);
    expect(r.tier).toBe("seasonPhase");
    expect(r.value).toEqual({ text: 5, image: 0 });
  });

  describe("slot pinning against the phase (difficultyRatio)", () => {
    const phase: PhaseSlice = {
      slug: "gauntlet",
      difficultyRatio: { boolean: { easy: 0, medium: 0, hard: 1 } },
    };

    it("a seasonSlot override pins the axis, beating the phase", () => {
      const s = season({
        phases: [phase],
        slotOverrides: { 0: { difficultyRatio: { boolean: { easy: 1, medium: 0, hard: 0 } } } },
      });
      const ctx = buildCascadeContext(s, baseGame, 0, null, { slug: "gauntlet" });
      const r = resolveCascade("difficultyRatio", ctx, { answersFormat: "boolean" });
      expect(r.tier).toBe("seasonSlot");
      expect(r.value).toEqual({ easy: 1, medium: 0, hard: 0 });
    });

    it("the phase wins when the slot leaves the axis unset", () => {
      const s = season({ phases: [phase], slotOverrides: { 0: { label: "L" } } });
      const ctx = buildCascadeContext(s, baseGame, 0, null, { slug: "gauntlet" });
      const r = resolveCascade("difficultyRatio", ctx, { answersFormat: "boolean" });
      expect(r.tier).toBe("seasonPhase");
      expect(r.value).toEqual({ easy: 0, medium: 0, hard: 1 });
    });

    // Only a `seasonSlot` override pins an axis against an active phase — an axis set on the
    // GAME format's slot does NOT, because the cascade ranks `seasonPhase` above `gameSlot`.
    // This is CORRECT, not a bug: it mirrors the pre-existing rule that the whole `season`
    // tier (phases included) outranks `gameSlot`, so a season's intentional per-phase delta
    // always wins over the game's per-slot base. Do not "fix" the ordering.
    it("a game-format slot does NOT pin against the phase, but a seasonSlot override does", () => {
      const gameWithSlot: TriviaGame = {
        ...baseGame,
        format: { questions: [{ difficultyRatio: { boolean: { easy: 1, medium: 0, hard: 0 } } }] },
      };

      // No season slot override for index 0 → the game-format slot does NOT pin; phase wins.
      const s = season({ phases: [phase] });
      const ctx = buildCascadeContext(s, gameWithSlot, 0, null, { slug: "gauntlet" });
      const r = resolveCascade("difficultyRatio", ctx, { answersFormat: "boolean" });
      expect(r.tier).toBe("seasonPhase");
      expect(r.value).toEqual({ easy: 0, medium: 0, hard: 1 });
      const gameSlotRung = r.ladder.find((l) => l.tier === "gameSlot");
      expect(gameSlotRung?.present).toBe(true);
      expect(gameSlotRung?.winner).toBe(false);

      // Moving the SAME pin up to the season's slot override DOES beat the phase.
      const pinned = season({
        phases: [phase],
        slotOverrides: { 0: { difficultyRatio: { boolean: { easy: 1, medium: 0, hard: 0 } } } },
      });
      const pinnedCtx = buildCascadeContext(pinned, gameWithSlot, 0, null, { slug: "gauntlet" });
      const pinnedR = resolveCascade("difficultyRatio", pinnedCtx, { answersFormat: "boolean" });
      expect(pinnedR.tier).toBe("seasonSlot");
      expect(pinnedR.value).toEqual({ easy: 1, medium: 0, hard: 0 });
    });
  });

  it("difficulty per-field merge takes hard from the phase and easy/medium from the game", () => {
    const phase: PhaseSlice = { slug: "p", difficulty: { boolean: { hard: [9, 10] } } };
    const game: TriviaGame = {
      ...baseGame,
      difficulty: { boolean: { easy: [1, 2], medium: [3, 5] } },
    };
    const ctx = buildCascadeContext(season({ phases: [phase] }), game, null, null, { slug: "p" });
    const r = resolveCascade("difficulty", ctx, { answersFormat: "boolean" });
    expect(r.tier).toBe("merged");
    expect(r.value).toEqual({ easy: [1, 2], medium: [3, 5], hard: [9, 10] });
    const phaseRung = r.ladder.find((l) => l.tier === "seasonPhase");
    const gameRung = r.ladder.find((l) => l.tier === "game");
    expect(phaseRung?.present).toBe(true);
    expect(phaseRung?.value).toEqual({ boolean: { hard: [9, 10] } });
    expect(gameRung?.present).toBe(true);
    expect(gameRung?.value).toEqual({ boolean: { easy: [1, 2], medium: [3, 5] } });
  });

  it("difficultyRatio resolves first-wins from the phase tier", () => {
    const phase: PhaseSlice = {
      slug: "p",
      difficultyRatio: { choice: { easy: 7, medium: 2, hard: 1 } },
    };
    const ctx = buildCascadeContext(season({ phases: [phase] }), baseGame, null, null, {
      slug: "p",
    });
    const r = resolveCascade("difficultyRatio", ctx, { answersFormat: "choice" });
    expect(r.tier).toBe("seasonPhase");
    expect(r.value).toEqual({ easy: 7, medium: 2, hard: 1 });
  });

  it("additionalInstructions concatenates workspace + season + phase broadest-first, labelled [Phase]", () => {
    const phase: PhaseSlice = { slug: "p", additionalInstructions: "phase" };
    const s = season({ phases: [phase], additionalInstructions: "season" });
    const config: TriviaConfig = { additionalInstructions: "ws" };
    const ctx = buildCascadeContext(s, baseGame, null, config, { slug: "p" });
    const r = resolveCascade("additionalInstructions", ctx);
    expect(r.tier).toBe("merged");
    expect(r.value).toBe("[Workspace] ws\n\n[Season] season\n\n[Phase] phase");
  });

  it("every axis's ladder has one entry per CASCADE_TIER_ORDER member, in order, including seasonPhase", () => {
    const phase: PhaseSlice = { slug: "p", promptMedium: { text: 1, image: 0 } };
    const ctx = buildCascadeContext(season({ phases: [phase] }), baseGame, 0, null, { slug: "p" });
    for (const key of AXIS_KEYS) {
      const r = resolveCascade(key, ctx, { answersFormat: "boolean" });
      expect(r.ladder.map((l) => l.tier)).toEqual([...CASCADE_TIER_ORDER]);
      expect(r.ladder.some((l) => l.tier === "seasonPhase")).toBe(true);
    }
  });

  it("no axis reports seasonPhase when the context has no active phase (regression)", () => {
    const config: TriviaConfig = {
      promptMedium: { text: 1, image: 9 },
      additionalInstructions: "ws",
    };
    const game: TriviaGame = { ...baseGame, promptMedium: { text: 2, image: 0 } };
    const s = season({
      phases: [{ slug: "p", promptMedium: { text: 5, image: 0 } }],
      difficultyRatio: { boolean: { easy: 1, medium: 1, hard: 1 } },
    });
    // `{}` selects NO phase, so the seasonPhase tier is inert.
    const ctx = buildCascadeContext(s, game, 0, config, {});
    expect(ctx.seasonPhase).toBeNull();
    for (const key of AXIS_KEYS) {
      const r = resolveCascade(key, ctx, { answersFormat: "boolean" });
      expect(r.tier).not.toBe("seasonPhase");
    }
  });
});

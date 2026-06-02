import { describe, it, expect } from "vitest";
import { parseTriviaGame } from "./games.js";
import { AXIS_KEYS, AXIS_REGISTRY } from "../../domain/resolveCascade.js";
import type { JsonValue } from "../configTypes.js";

/**
 * The sync lock at runtime: the config parser MUST accept every `CascadeAxes` member, or
 * an axis could be a registry/resolver concept that admins can't actually set. The
 * compile-time `AxisRegistry` mapped type covers registry⇄CascadeAxes; this covers
 * parser⇄CascadeAxes. Together they close the loop.
 */
describe("cascade parity — parser accepts every registry axis", () => {
  it("AXIS_KEYS equals the registry keys", () => {
    expect([...AXIS_KEYS].sort()).toEqual(Object.keys(AXIS_REGISTRY).sort());
  });

  it("parseTriviaGame preserves every cascading axis set at the game tier", () => {
    // A raw game with EVERY cascade axis set to a valid value.
    const raw: JsonValue = {
      name: "parity",
      channel: "C1",
      questionCron: "0 9 * * *",
      revealCron: "0 17 * * *",
      timezone: "UTC",
      answersFormat: { boolean: 1, choice: 1, freeform: 1 },
      questionType: { fact: 1, topical: 1 },
      promptMedium: { text: 1, image: 1 },
      freeformAnswerShape: {
        name: 1,
        place: 1,
        phrase: 1,
        title: 1,
        date: 1,
        countable: 1,
        other: 1,
      },
      contexts: [{ name: "lens-a" }],
      hint: { mode: "button" },
      judgeLeniency: "lenient",
      instructions: "do this",
      liveAnswersVisible: false,
      revealResponses: "no",
      difficulty: { boolean: { easy: [1, 2], medium: [3, 4], hard: [5, 6] } },
      difficultyRatio: { boolean: { easy: 1, medium: 1, hard: 1 } },
      additionalInstructions: "also this",
    };

    const { game, issues } = parseTriviaGame(raw, 0, new Set());
    expect(issues).toEqual([]);
    expect(game).not.toBeNull();

    // Every registry axis must survive parsing — a dropped axis means the parser
    // doesn't accept a CascadeAxes member, which is a parity break.
    const missing = AXIS_KEYS.filter((key) => game?.[key] === undefined);
    expect(missing).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { detectGameWriteShadowing } from "./shadowing.js";
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

describe("detectGameWriteShadowing", () => {
  it("reports season shadowing of an axis field", () => {
    const s = season({ answersFormat: { boolean: 1, choice: 0, freeform: 0 } });
    const r = detectGameWriteShadowing(["answersFormat"], s, baseGame);
    expect(r).toEqual({ tier: "season", slug: "s1", fields: ["answersFormat"] });
  });

  it("reports format as a string pseudo-field alongside axes", () => {
    const s = season({
      answersFormat: { boolean: 1, choice: 0, freeform: 0 },
      format: { questions: [{}] },
    });
    const r = detectGameWriteShadowing(["answersFormat", "format"], s, baseGame);
    expect(r).toEqual({ tier: "season", slug: "s1", fields: ["answersFormat", "format"] });
  });

  it("reports a game's own format slot shadowing its top-level axis (no slug)", () => {
    const game: TriviaGame = {
      ...baseGame,
      format: { questions: [{ answersFormat: { boolean: 0, choice: 1, freeform: 0 } }] },
    };
    const r = detectGameWriteShadowing(["answersFormat"], null, game);
    expect(r).toEqual({ tier: "slot", fields: ["answersFormat"] });
  });

  it("season format suppresses the game-own-slot check (season wins wholesale)", () => {
    const s = season({ format: { questions: [{}] } });
    const game: TriviaGame = {
      ...baseGame,
      format: { questions: [{ answersFormat: { boolean: 0, choice: 1, freeform: 0 } }] },
    };
    // answersFormat not set on the season → not season-shadowed; and because a season
    // format is active, the game's own format slot does not contribute → nothing.
    expect(detectGameWriteShadowing(["answersFormat"], s, game)).toBeUndefined();
  });

  it("returns undefined in the gap window (no season, no masking slot)", () => {
    expect(detectGameWriteShadowing(["answersFormat", "format"], null, baseGame)).toBeUndefined();
  });

  it("returns undefined when no written field is shadowed", () => {
    const s = season({ questionType: { fact: 1, topical: 0, prediction: 0 } }); // shadows a DIFFERENT field
    expect(detectGameWriteShadowing(["answersFormat"], s, baseGame)).toBeUndefined();
  });

  it("reports season shadowing of teams fields", () => {
    const s = season({ teams: [{ name: "Gold", userIds: ["U9"] }], teamsEnabled: false });
    const r = detectGameWriteShadowing(["teams", "teamsEnabled", "teamsScoring"], s, baseGame);
    expect(r).toEqual({ tier: "season", slug: "s1", fields: ["teams", "teamsEnabled"] });
  });

  it("teams fields have no slot tier — a game format never shadows them", () => {
    const game: TriviaGame = {
      ...baseGame,
      format: { questions: [{ answersFormat: { boolean: 0, choice: 1, freeform: 0 } }] },
    };
    expect(detectGameWriteShadowing(["teams", "teamsEnabled"], null, game)).toBeUndefined();
  });
});

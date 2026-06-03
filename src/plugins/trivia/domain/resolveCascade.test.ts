import { describe, it, expect } from "vitest";
import { resolveCascade, AXIS_REGISTRY } from "./resolveCascade.js";
import { buildCascadeContext } from "./cascadeContext.js";
import type { CascadeContext } from "../core/cascadeAxes.js";
import type { SeasonEntry, TriviaAnswersFormat } from "../core/types.js";
import type { TriviaGame, TriviaConfig } from "../core/configTypes.js";
import {
  DEFAULT_PROMPT_MEDIUM_WEIGHTS,
  DEFAULT_HINT_CONFIG,
  DEFAULT_JUDGE_LENIENCY,
  DEFAULT_DIFFICULTY_RANGES,
  DEFAULT_DIFFICULTY_RATIO,
} from "../core/configTypes.js";

function ctx(
  season: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  config: TriviaConfig | null,
): CascadeContext {
  return buildCascadeContext(season, game, slotIndex, config);
}

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

describe("resolveCascade — precedence (seasonSlot → season → gameSlot → game → workspace)", () => {
  const config: TriviaConfig = { promptMedium: { text: 1, image: 9 } };
  const game: TriviaGame = { ...baseGame, promptMedium: { text: 2, image: 0 } };

  it("default when nothing is set", () => {
    expect(resolveCascade("promptMedium", ctx(null, null, null, null)).tier).toBe("default");
  });

  it("workspace beats default", () => {
    expect(resolveCascade("promptMedium", ctx(null, null, null, config)).tier).toBe("workspace");
  });

  it("game beats workspace", () => {
    expect(resolveCascade("promptMedium", ctx(null, null, game, config)).tier).toBe("game");
  });

  it("gameSlot (game-format slot) beats game — the game-base tier", () => {
    const g: TriviaGame = {
      ...game,
      format: { questions: [{ promptMedium: { text: 5, image: 0 } }] },
    };
    const r = resolveCascade("promptMedium", ctx(null, 0, g, config));
    expect(r.tier).toBe("gameSlot");
    expect(r.value).toEqual({ text: 5, image: 0 });
  });

  it("season beats gameSlot", () => {
    const g: TriviaGame = {
      ...game,
      format: { questions: [{ promptMedium: { text: 5, image: 0 } }] },
    };
    const withSeason = season({ promptMedium: { text: 3, image: 0 } });
    expect(resolveCascade("promptMedium", ctx(withSeason, 0, g, config)).tier).toBe("season");
  });

  it("seasonSlot (slotOverrides) beats everything", () => {
    const g: TriviaGame = {
      ...game,
      format: { questions: [{ promptMedium: { text: 5, image: 0 } }] },
    };
    const withOverride = season({
      promptMedium: { text: 3, image: 0 },
      slotOverrides: { 0: { promptMedium: { text: 7, image: 0 } } },
    });
    const r = resolveCascade("promptMedium", ctx(withOverride, 0, g, config));
    expect(r.tier).toBe("seasonSlot");
    expect(r.value).toEqual({ text: 7, image: 0 });
  });

  it("falls through to the registry default", () => {
    const r = resolveCascade("promptMedium", ctx(null, null, null, null));
    expect(r.value).toEqual(DEFAULT_PROMPT_MEDIUM_WEIGHTS);
    expect(r.tier).toBe("default");
  });
});

describe("resolveCascade — game-format slot is honored with no active season", () => {
  it("a game-format slot's answersFormat resolves at tier gameSlot", () => {
    const game: TriviaGame = {
      ...baseGame,
      format: { questions: [{ answersFormat: { boolean: 0, choice: 1, freeform: 0 } }] },
    };
    const r = resolveCascade("answersFormat", ctx(null, 0, game, null));
    expect(r.tier).toBe("gameSlot");
    expect(r.value).toEqual({ boolean: 0, choice: 1, freeform: 0 });
  });
});

describe("resolveCascade — custom provenance", () => {
  it("additionalInstructions reports merged when >1 tier contributes", () => {
    const config: TriviaConfig = { additionalInstructions: "ws" };
    const game: TriviaGame = { ...baseGame, additionalInstructions: "game" };
    const r = resolveCascade("additionalInstructions", ctx(null, null, game, config));
    expect(r.tier).toBe("merged");
    expect(r.value).toContain("ws");
    expect(r.value).toContain("game");
  });

  it("additionalInstructions concatenates broadest-first with tier labels", () => {
    const config: TriviaConfig = { additionalInstructions: "ws" };
    const game: TriviaGame = { ...baseGame, additionalInstructions: "game" };
    const withOverride = season({ slotOverrides: { 0: { additionalInstructions: "slot" } } });
    const r = resolveCascade("additionalInstructions", ctx(withOverride, 0, game, config));
    expect(r.value).toBe("[Workspace] ws\n\n[Game] game\n\n[Season Slot 0] slot");
  });

  it("additionalInstructions labels a game-format slot segment as [Game Slot N]", () => {
    const game: TriviaGame = {
      ...baseGame,
      additionalInstructions: "game-add",
      format: { questions: [{ additionalInstructions: "game-slot-add" }] },
    };
    const r = resolveCascade("additionalInstructions", ctx(null, 0, game, null));
    expect(r.value).toBe("[Game] game-add\n\n[Game Slot 0] game-slot-add");
    expect(r.tier).toBe("merged");
  });

  it("additionalInstructions reports the single tier when only one contributes", () => {
    const game: TriviaGame = { ...baseGame, additionalInstructions: "game" };
    expect(resolveCascade("additionalInstructions", ctx(null, null, game, null)).tier).toBe("game");
  });

  it("difficulty value comes from the same tier the ladder reports (value ≡ ladder)", () => {
    const config: TriviaConfig = { difficulty: { boolean: { easy: [1, 2] } } };
    const game: TriviaGame = { ...baseGame, difficulty: { boolean: { hard: [9, 10] } } };
    const r = resolveCascade("difficulty", ctx(null, null, game, config), {
      answersFormat: "boolean",
    });
    expect(r.tier).toBe("merged");
    // easy came from workspace, hard from game — the value reflects both.
    expect(r.value.easy).toEqual([1, 2]);
    expect(r.value.hard).toEqual([9, 10]);
    const easyLadder = r.ladder.find((l) => l.tier === "workspace");
    const hardLadder = r.ladder.find((l) => l.tier === "game");
    expect(easyLadder?.present).toBe(true);
    expect(hardLadder?.present).toBe(true);
  });

  it("difficulty merges a gameSlot field over the game field", () => {
    const game: TriviaGame = {
      ...baseGame,
      difficulty: { boolean: { easy: [1, 2], hard: [9, 10] } },
      format: { questions: [{ difficulty: { boolean: { hard: [10, 10] } } }] },
    };
    const r = resolveCascade("difficulty", ctx(null, 0, game, null), { answersFormat: "boolean" });
    expect(r.value.easy).toEqual([1, 2]); // from game
    expect(r.value.hard).toEqual([10, 10]); // from gameSlot
    expect(r.tier).toBe("merged");
  });

  it("difficulty/difficultyRatio throw without answersFormat", () => {
    expect(() => resolveCascade("difficulty", ctx(null, null, null, null))).toThrow(
      /answersFormat/,
    );
    expect(() => resolveCascade("difficultyRatio", ctx(null, null, null, null))).toThrow(
      /answersFormat/,
    );
  });
});

describe("AXIS_REGISTRY", () => {
  it("registry defaults equal the DEFAULT_* constants", () => {
    const empty = ctx(null, null, null, null);
    expect(resolveCascade("promptMedium", empty).value).toEqual(DEFAULT_PROMPT_MEDIUM_WEIGHTS);
    expect(resolveCascade("hint", empty).value).toEqual(DEFAULT_HINT_CONFIG);
    expect(resolveCascade("judgeLeniency", empty).value).toEqual(DEFAULT_JUDGE_LENIENCY);
    expect(resolveCascade("liveAnswersVisible", empty).value).toBe(true);
    expect(resolveCascade("revealResponses", empty).value).toBe("yes");
    expect(resolveCascade("contexts", empty).value).toBeNull();
    expect(resolveCascade("instructions", empty).value).toBeNull();
    expect(resolveCascade("difficulty", empty, { answersFormat: "boolean" }).value).toEqual(
      DEFAULT_DIFFICULTY_RANGES.boolean,
    );
    expect(resolveCascade("difficultyRatio", empty, { answersFormat: "freeform" }).value).toEqual(
      DEFAULT_DIFFICULTY_RATIO.freeform,
    );
  });

  it("custom axes match across every answersFormat", () => {
    const game: TriviaGame = {
      ...baseGame,
      difficultyRatio: { choice: { easy: 7, medium: 2, hard: 1 } },
    };
    const formats: TriviaAnswersFormat[] = ["boolean", "choice", "freeform"];
    for (const f of formats) {
      const ranges = resolveCascade("difficulty", ctx(null, null, game, null), {
        answersFormat: f,
      });
      expect(ranges.value).toEqual(DEFAULT_DIFFICULTY_RANGES[f]);
    }
    expect(
      resolveCascade("difficultyRatio", ctx(null, null, game, null), { answersFormat: "choice" })
        .value,
    ).toEqual({ easy: 7, medium: 2, hard: 1 });
  });

  it("has exactly the 13 cascade-axis keys", () => {
    expect(Object.keys(AXIS_REGISTRY).sort()).toEqual(
      [
        "additionalInstructions",
        "answersFormat",
        "contexts",
        "difficulty",
        "difficultyRatio",
        "freeformAnswerShape",
        "hint",
        "instructions",
        "judgeLeniency",
        "liveAnswersVisible",
        "promptMedium",
        "questionType",
        "revealResponses",
      ].sort(),
    );
  });
});

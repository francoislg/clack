import { describe, it, expect } from "vitest";
import { resolveCascade, AXIS_REGISTRY } from "./resolveCascade.js";
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
// Legacy resolvers — the walker MUST stay byte-identical to these.
import { resolveAnswersFormat } from "./questionTypes.js";
import { resolveQuestionType } from "./factTopical.js";
import { resolvePromptMedium } from "./promptMediums.js";
import { resolveFreeformAnswerShape } from "./freeformAnswerShape.js";
import { resolveContexts } from "./contexts.js";
import { resolveHintConfig } from "./hint.js";
import { resolveJudgeLeniency } from "./judgeLeniency.js";
import { resolveInstructions, resolveAdditionalInstructions } from "./instructions.js";
import { resolveDifficultyRanges, resolveDifficultyRatio } from "./difficulty.js";
import { resolveLiveAnswersVisible } from "../core/liveAnswersResolver.js";
import { resolveRevealResponses } from "../core/revealResponsesResolver.js";

/** Build a CascadeContext from the legacy resolvers' positional inputs. */
function toCtx(
  season: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  config: TriviaConfig | null,
): CascadeContext {
  const slot =
    season !== null && slotIndex !== null && season.format !== undefined
      ? (season.format.questions[slotIndex] ?? null)
      : null;
  return { slot, slotIndex, season, game, config };
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

describe("resolveCascade — precedence", () => {
  it("first-wins: slot beats season beats game beats workspace beats default", () => {
    const config: TriviaConfig = { promptMedium: { text: 1, image: 9 } };
    const game: TriviaGame = { ...baseGame, promptMedium: { text: 2, image: 0 } };
    const withSeason = season({ promptMedium: { text: 3, image: 0 } });
    const withSlot = season({
      promptMedium: { text: 3, image: 0 },
      format: { questions: [{ promptMedium: { text: 4, image: 0 } }] },
    });

    expect(resolveCascade("promptMedium", toCtx(null, null, null, null)).tier).toBe("default");
    expect(resolveCascade("promptMedium", toCtx(null, null, null, config)).tier).toBe("workspace");
    expect(resolveCascade("promptMedium", toCtx(null, null, game, config)).tier).toBe("game");
    expect(resolveCascade("promptMedium", toCtx(withSeason, null, game, config)).tier).toBe(
      "season",
    );
    expect(resolveCascade("promptMedium", toCtx(withSlot, 0, game, config)).tier).toBe("slot");
  });

  it("falls through to the registry default", () => {
    const r = resolveCascade("promptMedium", toCtx(null, null, null, null));
    expect(r.value).toEqual(DEFAULT_PROMPT_MEDIUM_WEIGHTS);
    expect(r.tier).toBe("default");
  });
});

describe("resolveCascade — equivalence with legacy resolvers", () => {
  // A representative matrix: overrides scattered across tiers + an empty case.
  const config: TriviaConfig = {
    promptMedium: { text: 1, image: 1 },
    hint: { mode: "button" },
    judgeLeniency: "lenient",
    liveAnswersVisible: false,
    revealResponses: "no",
    instructions: "ws-instr",
    additionalInstructions: "ws-add",
    difficulty: { boolean: { easy: [1, 2] } },
    difficultyRatio: { boolean: { easy: 9, medium: 1, hard: 0 } },
  };
  const game: TriviaGame = {
    ...baseGame,
    answersFormat: { boolean: 0, choice: 1, freeform: 0 },
    contexts: [{ name: "lens-a" }],
    additionalInstructions: "game-add",
  };
  const withFmt = season({
    questionType: { fact: 0, topical: 1 },
    freeformAnswerShape: {
      name: 1,
      place: 0,
      phrase: 0,
      title: 0,
      date: 0,
      countable: 0,
      other: 0,
    },
    additionalInstructions: "season-add",
    format: { questions: [{ promptMedium: { text: 0, image: 1 }, hint: { mode: "inline" } }] },
  });
  const ctx = toCtx(withFmt, 0, game, config);

  it("first-wins axes match", () => {
    expect(resolveCascade("answersFormat", ctx).value).toEqual(
      resolveAnswersFormat(withFmt, 0, game, config),
    );
    expect(resolveCascade("questionType", ctx).value).toEqual(
      resolveQuestionType(withFmt, 0, game, config),
    );
    expect(resolveCascade("promptMedium", ctx).value).toEqual(
      resolvePromptMedium(withFmt, 0, game, config),
    );
    expect(resolveCascade("freeformAnswerShape", ctx).value).toEqual(
      resolveFreeformAnswerShape(withFmt, 0, game, config),
    );
    expect(resolveCascade("contexts", ctx).value).toEqual(
      resolveContexts(withFmt, 0, game, config),
    );
    expect(resolveCascade("hint", ctx).value).toEqual(resolveHintConfig(0, withFmt, game, config));
    expect(resolveCascade("judgeLeniency", ctx).value).toEqual(
      resolveJudgeLeniency(0, withFmt, game, config),
    );
    expect(resolveCascade("instructions", ctx).value).toEqual(
      resolveInstructions(withFmt, 0, game, config),
    );
    expect(resolveCascade("liveAnswersVisible", ctx).value).toBe(
      resolveLiveAnswersVisible({ slot: ctx.slot ?? undefined, season: withFmt, game, config }),
    );
    expect(resolveCascade("revealResponses", ctx).value).toBe(
      resolveRevealResponses({ slot: ctx.slot ?? undefined, season: withFmt, game, config }),
    );
  });

  it("custom axes match for every answersFormat", () => {
    const formats: TriviaAnswersFormat[] = ["boolean", "choice", "freeform"];
    for (const f of formats) {
      expect(resolveCascade("difficulty", ctx, { answersFormat: f }).value).toEqual(
        resolveDifficultyRanges(withFmt, 0, game, config, f),
      );
      expect(resolveCascade("difficultyRatio", ctx, { answersFormat: f }).value).toEqual(
        resolveDifficultyRatio(withFmt, 0, game, config, f),
      );
    }
    expect(resolveCascade("additionalInstructions", ctx).value).toEqual(
      resolveAdditionalInstructions(withFmt, 0, game, config),
    );
  });
});

describe("resolveCascade — custom provenance", () => {
  it("additionalInstructions reports merged when >1 tier contributes", () => {
    const config: TriviaConfig = { additionalInstructions: "ws" };
    const game: TriviaGame = { ...baseGame, additionalInstructions: "game" };
    const r = resolveCascade("additionalInstructions", toCtx(null, null, game, config));
    expect(r.tier).toBe("merged");
    expect(r.value).toContain("ws");
    expect(r.value).toContain("game");
  });

  it("additionalInstructions reports the single tier when only one contributes", () => {
    const game: TriviaGame = { ...baseGame, additionalInstructions: "game" };
    expect(resolveCascade("additionalInstructions", toCtx(null, null, game, null)).tier).toBe(
      "game",
    );
  });

  it("difficulty reports merged when fields span tiers", () => {
    const config: TriviaConfig = { difficulty: { boolean: { easy: [1, 2] } } };
    const game: TriviaGame = { ...baseGame, difficulty: { boolean: { hard: [9, 10] } } };
    const r = resolveCascade("difficulty", toCtx(null, null, game, config), {
      answersFormat: "boolean",
    });
    expect(r.tier).toBe("merged");
  });

  it("difficulty/difficultyRatio throw without answersFormat", () => {
    expect(() => resolveCascade("difficulty", toCtx(null, null, null, null))).toThrow(
      /answersFormat/,
    );
    expect(() => resolveCascade("difficultyRatio", toCtx(null, null, null, null))).toThrow(
      /answersFormat/,
    );
  });
});

describe("AXIS_REGISTRY", () => {
  it("registry defaults equal the legacy DEFAULT_* constants", () => {
    const empty = toCtx(null, null, null, null);
    expect(resolveCascade("promptMedium", empty).value).toEqual(DEFAULT_PROMPT_MEDIUM_WEIGHTS);
    expect(resolveCascade("hint", empty).value).toEqual(DEFAULT_HINT_CONFIG);
    expect(resolveCascade("judgeLeniency", empty).value).toEqual(DEFAULT_JUDGE_LENIENCY);
    expect(resolveCascade("liveAnswersVisible", empty).value).toBe(true);
    expect(resolveCascade("revealResponses", empty).value).toBe("yes");
    expect(resolveCascade("contexts", empty).value).toBeNull();
    expect(resolveCascade("instructions", empty).value).toBeNull();
    // custom defaults are per-answersFormat
    expect(resolveCascade("difficulty", empty, { answersFormat: "boolean" }).value).toEqual(
      DEFAULT_DIFFICULTY_RANGES.boolean,
    );
    expect(resolveCascade("difficultyRatio", empty, { answersFormat: "freeform" }).value).toEqual(
      DEFAULT_DIFFICULTY_RATIO.freeform,
    );
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

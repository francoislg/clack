import { describe, it, expect, beforeEach } from "vitest";
import { parseTriviaGame } from "./games.js";
import {
  normalizeAdditionalInstructions,
  parseCumulativeInstructions,
  validateFormat,
  validateSlotOverrides,
} from "./format.js";
import { normalizePhaseSlices, parsePhases, phasesStrictZod } from "./phases.js";
import {
  _resetTriviaConfigBridge,
  initTriviaConfigBridge,
  loadTriviaConfig,
} from "../configBridge.js";
import { createFakeSdk, type FakeSdk } from "../../testHelpers.fakeSdk.js";

const RAW_GAME = {
  name: "g",
  channel: "C1",
  questionCron: "0 9 * * *",
  revealCron: "0 17 * * *",
  timezone: "UTC",
};

describe("judgeInstructions — shared cumulative-field validation", () => {
  it("parseCumulativeInstructions trims a non-empty string", () => {
    expect(parseCumulativeInstructions("  Accept French.  ")).toEqual({
      ok: true,
      value: "Accept French.",
    });
  });

  it("parseCumulativeInstructions rejects a non-string and a blank string", () => {
    expect(parseCumulativeInstructions(42)).toEqual({ ok: false, error: "must be a string" });
    expect(parseCumulativeInstructions("   ")).toEqual({
      ok: false,
      error: "must be non-empty after trim",
    });
  });

  it("the normalizer names the field it was asked to validate", () => {
    expect(normalizeAdditionalInstructions("  ", "judgeInstructions")).toEqual({
      ok: false,
      error: "judgeInstructions must be non-empty (pass null to clear).",
    });
    expect(normalizeAdditionalInstructions("  ")).toEqual({
      ok: false,
      error: "additionalInstructions must be non-empty (pass null to clear).",
    });
    expect(normalizeAdditionalInstructions(" ok ", "judgeInstructions")).toEqual({
      ok: true,
      value: "ok",
    });
  });
});

describe("judgeInstructions — game tier (parseTriviaGame)", () => {
  it("keeps a trimmed value", () => {
    const { game, issues } = parseTriviaGame(
      { ...RAW_GAME, judgeInstructions: "  Accept French or English.  " },
      0,
      new Set(),
    );
    expect(issues).toEqual([]);
    expect(game?.judgeInstructions).toBe("Accept French or English.");
  });

  it("rejects a blank value with an issue naming the field, and does not apply it", () => {
    const { game, issues } = parseTriviaGame(
      { ...RAW_GAME, judgeInstructions: "   " },
      0,
      new Set(),
    );
    expect(issues).toEqual([
      { field: "trivia.games[0].judgeInstructions", error: "must be non-empty after trim" },
    ]);
    expect(game?.judgeInstructions).toBeUndefined();
  });

  it("rejects a non-string value", () => {
    const { game, issues } = parseTriviaGame({ ...RAW_GAME, judgeInstructions: 3 }, 0, new Set());
    expect(issues).toEqual([
      { field: "trivia.games[0].judgeInstructions", error: "must be a string" },
    ]);
    expect(game?.judgeInstructions).toBeUndefined();
  });
});

describe("judgeInstructions — slot tier", () => {
  it("validateFormat keeps a trimmed slot value", () => {
    const r = validateFormat({ questions: [{ judgeInstructions: " Slot rule. " }] });
    expect(r).toEqual({ ok: true, value: { questions: [{ judgeInstructions: "Slot rule." }] } });
  });

  it("validateFormat rejects a blank slot value, naming the slot and field", () => {
    const r = validateFormat({ questions: [{}, { judgeInstructions: "  " }] });
    expect(r).toEqual({
      ok: false,
      error: "'format.questions[1].judgeInstructions' must be non-empty after trim",
    });
  });

  it("validateSlotOverrides keeps the value on a season slot override", () => {
    const r = validateSlotOverrides({ 2: { judgeInstructions: "Override rule." } });
    expect(r).toEqual({ ok: true, value: { 2: { judgeInstructions: "Override rule." } } });
  });
});

describe("judgeInstructions — phase tier", () => {
  it("the tool path keeps a trimmed value on a slice", () => {
    const structural = phasesStrictZod.parse([
      { slug: "ramp", days: 5, judgeInstructions: " Ramp rule. " },
      { slug: "gauntlet" },
    ]);
    const r = normalizePhaseSlices(structural);
    expect(r).toEqual({
      ok: true,
      value: [{ slug: "ramp", days: 5, judgeInstructions: "Ramp rule." }, { slug: "gauntlet" }],
    });
  });

  it("the tool path rejects a blank value, naming the slice and field", () => {
    const structural = phasesStrictZod.parse([{ slug: "ramp", judgeInstructions: "  " }]);
    expect(normalizePhaseSlices(structural)).toEqual({
      ok: false,
      error: `'phase "ramp".judgeInstructions' must be non-empty after trim`,
    });
  });

  it("the graceful reader drops only the blank field and keeps the slice", () => {
    const { phases, issues } = parsePhases(
      [{ slug: "ramp", judgeInstructions: "  ", judgeLeniency: "evaluate" }],
      "s1",
    );
    expect(phases).toEqual([{ slug: "ramp", judgeLeniency: "evaluate" }]);
    expect(issues).toEqual([
      {
        field: "seasons[s1].phases[0].judgeInstructions",
        error: "'seasons[s1].phases[0].judgeInstructions' must be non-empty after trim",
      },
    ]);
  });
});

describe("judgeInstructions — workspace tier (config bridge)", () => {
  let sdk: FakeSdk;

  beforeEach(() => {
    _resetTriviaConfigBridge();
    sdk = createFakeSdk().sdk;
  });

  it("keeps a trimmed workspace value", async () => {
    await sdk.writeFile("config.json", JSON.stringify({ judgeInstructions: "  Be generous.  " }));
    await initTriviaConfigBridge(sdk);
    expect(loadTriviaConfig()?.judgeInstructions).toBe("Be generous.");
  });

  it("warns naming the field and does not apply a blank workspace value", async () => {
    await sdk.writeFile("config.json", JSON.stringify({ judgeInstructions: "   " }));
    await initTriviaConfigBridge(sdk);
    expect(loadTriviaConfig()?.judgeInstructions).toBeUndefined();
    expect(sdk.logger.warn).toHaveBeenCalledWith(
      "Trivia plugin config: 'trivia.judgeInstructions': must be non-empty after trim",
    );
  });
});

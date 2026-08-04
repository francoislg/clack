import { describe, it, expect } from "vitest";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import type { SeasonEntry } from "../core/types.js";
import { resolvePerfectRoundsAward } from "./resolvePerfectRoundsAward.js";

function season(perfectRoundsAward?: SeasonEntry["perfectRoundsAward"]): SeasonEntry {
  return {
    slug: "s1",
    startedAt: 0,
    expectedEndAt: 1,
    ...(perfectRoundsAward !== undefined ? { perfectRoundsAward } : {}),
  };
}

function game(perfectRoundsAward?: TriviaGame["perfectRoundsAward"]): TriviaGame {
  return {
    name: "main",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "America/Montreal",
    ...(perfectRoundsAward !== undefined ? { perfectRoundsAward } : {}),
  };
}

describe("resolvePerfectRoundsAward — cascade season → game → workspace → default", () => {
  it("defaults to { enabled: false } when no tier sets it", () => {
    expect(resolvePerfectRoundsAward(null, null, null)).toEqual({ enabled: false });
    expect(resolvePerfectRoundsAward(season(), game(), null)).toEqual({ enabled: false });
  });

  it("workspace tier wins over the default", () => {
    const workspace: TriviaConfig = { perfectRoundsAward: { enabled: true } };
    expect(resolvePerfectRoundsAward(season(), game(), workspace)).toEqual({ enabled: true });
    expect(resolvePerfectRoundsAward(null, null, workspace)).toEqual({ enabled: true });
  });

  it("game tier wins over workspace", () => {
    const workspace: TriviaConfig = { perfectRoundsAward: { enabled: true } };
    expect(resolvePerfectRoundsAward(season(), game({ enabled: false }), workspace)).toEqual({
      enabled: false,
    });
  });

  it("season tier wins over game", () => {
    const workspace: TriviaConfig = { perfectRoundsAward: { enabled: false } };
    const g = game({ enabled: false });
    expect(resolvePerfectRoundsAward(season({ enabled: true }), g, workspace)).toEqual({
      enabled: true,
    });
  });

  it("season tier wins over the default with no game or workspace value", () => {
    expect(resolvePerfectRoundsAward(season({ enabled: true }), null, null)).toEqual({
      enabled: true,
    });
  });

  it("game tier wins over the default with no season or workspace value", () => {
    expect(resolvePerfectRoundsAward(null, game({ enabled: true }), null)).toEqual({
      enabled: true,
    });
  });

  it("treats an explicit { enabled: false } at a tier as a set value, not absent", () => {
    const workspace: TriviaConfig = { perfectRoundsAward: { enabled: true } };
    expect(resolvePerfectRoundsAward(season(), game({ enabled: false }), workspace)).toEqual({
      enabled: false,
    });
  });

  it("handles null tier arguments by falling through to the next tier", () => {
    const g: TriviaGame = game({ enabled: true });
    expect(resolvePerfectRoundsAward(null, g, null)).toEqual({ enabled: true });

    const workspace: TriviaConfig = { perfectRoundsAward: { enabled: false } };
    expect(resolvePerfectRoundsAward(null, null, workspace)).toEqual({ enabled: false });
  });
});

import { describe, it, expect } from "vitest";
import { resolveScrollToTop } from "./scrollToTop.js";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";

function game(scrollToTop?: boolean): TriviaGame {
  return {
    name: "g",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "UTC",
    enabled: true,
    ...(scrollToTop !== undefined ? { scrollToTop } : {}),
  };
}

function workspace(scrollToTop?: boolean): TriviaConfig {
  return scrollToTop !== undefined ? { scrollToTop } : {};
}

describe("resolveScrollToTop", () => {
  it("game tier wins over workspace", () => {
    expect(resolveScrollToTop(game(true), workspace(false))).toBe(true);
    expect(resolveScrollToTop(game(false), workspace(true))).toBe(false);
  });

  it("falls back to workspace when game is unset", () => {
    expect(resolveScrollToTop(game(), workspace(true))).toBe(true);
  });

  it("defaults to false when neither tier sets it", () => {
    expect(resolveScrollToTop(game(), workspace())).toBe(false);
    expect(resolveScrollToTop(null, null)).toBe(false);
  });
});

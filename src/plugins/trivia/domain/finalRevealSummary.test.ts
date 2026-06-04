import { describe, it, expect } from "vitest";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { resolveFinalRevealSummary } from "./finalRevealSummary.js";

function game(finalRevealSummary?: TriviaGame["finalRevealSummary"]): TriviaGame {
  return {
    name: "main",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "America/Montreal",
    ...(finalRevealSummary !== undefined ? { finalRevealSummary } : {}),
  };
}

describe("resolveFinalRevealSummary — cascade game → workspace → default", () => {
  it("defaults to yes when no tier sets it", () => {
    expect(resolveFinalRevealSummary(null, null)).toBe("yes");
    expect(resolveFinalRevealSummary(game(), {})).toBe("yes");
  });

  it("workspace tier wins over the default", () => {
    const workspace: TriviaConfig = { finalRevealSummary: "in-thread" };
    expect(resolveFinalRevealSummary(game(), workspace)).toBe("in-thread");
    expect(resolveFinalRevealSummary(null, workspace)).toBe("in-thread");
  });

  it("game tier wins over workspace", () => {
    const workspace: TriviaConfig = { finalRevealSummary: "no" };
    expect(resolveFinalRevealSummary(game("in-thread"), workspace)).toBe("in-thread");
  });

  it("game tier wins over the default with no workspace value", () => {
    expect(resolveFinalRevealSummary(game("no"), {})).toBe("no");
  });
});

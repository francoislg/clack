import { describe, it, expect } from "vitest";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { resolveIncludeRevealInQuestions } from "./includeRevealInQuestions.js";

function game(includeRevealInQuestions?: TriviaGame["includeRevealInQuestions"]): TriviaGame {
  return {
    name: "main",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "America/Montreal",
    ...(includeRevealInQuestions !== undefined ? { includeRevealInQuestions } : {}),
  };
}

describe("resolveIncludeRevealInQuestions — cascade game → workspace → default", () => {
  it("defaults to no when no tier sets it", () => {
    expect(resolveIncludeRevealInQuestions(null, null)).toBe("no");
    expect(resolveIncludeRevealInQuestions(game(), {})).toBe("no");
  });

  it("workspace tier wins over the default", () => {
    const workspace: TriviaConfig = { includeRevealInQuestions: "yes" };
    expect(resolveIncludeRevealInQuestions(game(), workspace)).toBe("yes");
    expect(resolveIncludeRevealInQuestions(null, workspace)).toBe("yes");
  });

  it("game tier wins over workspace", () => {
    const workspace: TriviaConfig = { includeRevealInQuestions: "no" };
    expect(resolveIncludeRevealInQuestions(game("yes"), workspace)).toBe("yes");
  });

  it("game tier wins over the default with no workspace value", () => {
    expect(resolveIncludeRevealInQuestions(game("yes"), {})).toBe("yes");
  });
});

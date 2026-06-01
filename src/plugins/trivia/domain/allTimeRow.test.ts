import { describe, it, expect } from "vitest";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { resolveAllTimeRow, shouldShowAllTimeRow } from "./allTimeRow.js";

function game(allTimeRow?: TriviaGame["allTimeRow"]): TriviaGame {
  return {
    name: "main",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "America/Montreal",
    ...(allTimeRow !== undefined ? { allTimeRow } : {}),
  };
}

describe("resolveAllTimeRow — cascade game → workspace → default", () => {
  it("defaults to end-of-season-only when no tier sets it", () => {
    expect(resolveAllTimeRow(null, null)).toBe("end-of-season-only");
    expect(resolveAllTimeRow(game(), {})).toBe("end-of-season-only");
  });

  it("workspace tier wins over the default", () => {
    const workspace: TriviaConfig = { allTimeRow: "always" };
    expect(resolveAllTimeRow(game(), workspace)).toBe("always");
    expect(resolveAllTimeRow(null, workspace)).toBe("always");
  });

  it("game tier wins over workspace", () => {
    const workspace: TriviaConfig = { allTimeRow: "never" };
    expect(resolveAllTimeRow(game("always"), workspace)).toBe("always");
  });

  it("game tier wins over the default with no workspace value", () => {
    expect(resolveAllTimeRow(game("never"), {})).toBe("never");
  });
});

describe("shouldShowAllTimeRow", () => {
  it("always → true regardless of last fire", () => {
    expect(shouldShowAllTimeRow("always", false)).toBe(true);
    expect(shouldShowAllTimeRow("always", true)).toBe(true);
  });

  it("never → false regardless of last fire", () => {
    expect(shouldShowAllTimeRow("never", false)).toBe(false);
    expect(shouldShowAllTimeRow("never", true)).toBe(false);
  });

  it("end-of-season-only → tracks isLastFireOfSeason", () => {
    expect(shouldShowAllTimeRow("end-of-season-only", false)).toBe(false);
    expect(shouldShowAllTimeRow("end-of-season-only", true)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { resolveTagPlayers, renderPlayerRef } from "./tagPlayers.js";

function game(tagPlayers?: TriviaGame["tagPlayers"]): TriviaGame {
  return {
    name: "main",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "America/Montreal",
    ...(tagPlayers !== undefined ? { tagPlayers } : {}),
  };
}

describe("resolveTagPlayers — cascade game → workspace → default", () => {
  it("defaults to true when no tier sets it", () => {
    expect(resolveTagPlayers(null, null)).toBe(true);
    expect(resolveTagPlayers(game(), {})).toBe(true);
  });

  it("workspace tier wins over the default", () => {
    const workspace: TriviaConfig = { tagPlayers: false };
    expect(resolveTagPlayers(game(), workspace)).toBe(false);
    expect(resolveTagPlayers(null, workspace)).toBe(false);
  });

  it("game tier wins over workspace", () => {
    const workspace: TriviaConfig = { tagPlayers: true };
    expect(resolveTagPlayers(game(false), workspace)).toBe(false);
  });

  it("game tier wins over the default with no workspace value", () => {
    expect(resolveTagPlayers(game(false), {})).toBe(false);
  });

  it("treats an explicit false at a tier as a set value, not absent", () => {
    // false is falsy — guard against `if (game.tagPlayers)` regressions.
    expect(resolveTagPlayers(game(false), { tagPlayers: true })).toBe(false);
  });
});

describe("renderPlayerRef", () => {
  it("emits a real mention when tagging is on", () => {
    expect(renderPlayerRef("U123", "Alice", true)).toBe("<@U123>");
  });

  it("emits plain @displayName when tagging is off", () => {
    expect(renderPlayerRef("U123", "Alice", false)).toBe("@Alice");
  });
});

import { describe, it, expect } from "vitest";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { resolveTellMeMore } from "./tellMeMore.js";

function game(tellMeMore?: TriviaGame["tellMeMore"]): TriviaGame {
  return {
    name: "main",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "America/Montreal",
    ...(tellMeMore !== undefined ? { tellMeMore } : {}),
  };
}

describe("resolveTellMeMore — cascade game → workspace → default", () => {
  it("defaults to disabled when no tier sets it", () => {
    expect(resolveTellMeMore(null, null)).toEqual({ enabled: false });
    expect(resolveTellMeMore(game(), {})).toEqual({ enabled: false });
  });

  it("workspace tier wins over the default", () => {
    const workspace: TriviaConfig = { tellMeMore: { enabled: true } };
    expect(resolveTellMeMore(game(), workspace)).toEqual({ enabled: true });
    expect(resolveTellMeMore(null, workspace)).toEqual({ enabled: true });
  });

  it("game tier wins over workspace", () => {
    const workspace: TriviaConfig = { tellMeMore: { enabled: true } };
    expect(resolveTellMeMore(game({ enabled: false }), workspace)).toEqual({ enabled: false });
  });

  it("game tier wins over the default with no workspace value", () => {
    expect(resolveTellMeMore(game({ enabled: true }), {})).toEqual({ enabled: true });
  });
});

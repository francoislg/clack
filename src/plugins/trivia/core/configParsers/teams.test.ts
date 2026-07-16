import { describe, it, expect } from "vitest";
import { validateTeamsRoster, validateTeamsScoring } from "./teams.js";

describe("validateTeamsRoster", () => {
  it("accepts a valid roster and trims names and ids", () => {
    const r = validateTeamsRoster(
      [
        { name: " Red ", userIds: ["U1 ", "U2"] },
        { name: "Blue", userIds: ["U3"] },
      ],
      "trivia.teams",
    );
    expect(r).toEqual({
      ok: true,
      value: [
        { name: "Red", userIds: ["U1", "U2"] },
        { name: "Blue", userIds: ["U3"] },
      ],
    });
  });

  it("accepts an empty roster (explicit no-teams value)", () => {
    expect(validateTeamsRoster([], "trivia.teams")).toEqual({ ok: true, value: [] });
  });

  it("rejects an empty team name", () => {
    const r = validateTeamsRoster([{ name: "  ", userIds: ["U1"] }], "trivia.teams");
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate team names case-insensitively, naming the collision", () => {
    const r = validateTeamsRoster(
      [
        { name: "Red", userIds: ["U1"] },
        { name: "red", userIds: ["U2"] },
      ],
      "trivia.teams",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('duplicate team name "red"');
  });

  it("rejects an empty userIds array", () => {
    const r = validateTeamsRoster([{ name: "Red", userIds: [] }], "trivia.teams");
    expect(r.ok).toBe(false);
  });

  it("rejects a user appearing in two teams, naming the user", () => {
    const r = validateTeamsRoster(
      [
        { name: "Red", userIds: ["U1"] },
        { name: "Blue", userIds: ["U1"] },
      ],
      "trivia.teams",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('"U1"');
  });

  it("rejects a user listed twice in the same team", () => {
    const r = validateTeamsRoster([{ name: "Red", userIds: ["U1", "U1"] }], "trivia.teams");
    expect(r.ok).toBe(false);
  });

  it("rejects non-array input", () => {
    expect(validateTeamsRoster({ name: "Red" }, "trivia.teams").ok).toBe(false);
    expect(validateTeamsRoster("Red", "trivia.teams").ok).toBe(false);
  });
});

describe("validateTeamsScoring", () => {
  it("accepts every registry mode", () => {
    expect(validateTeamsScoring("one-right-is-right", "f")).toEqual({
      ok: true,
      value: "one-right-is-right",
    });
    expect(validateTeamsScoring("total-points", "f")).toEqual({ ok: true, value: "total-points" });
  });

  it("rejects unknown modes, naming the valid ones", () => {
    const r = validateTeamsScoring("winner-takes-all", "trivia.teamsScoring");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('"one-right-is-right"');
      expect(r.error).toContain('"total-points"');
    }
  });
});

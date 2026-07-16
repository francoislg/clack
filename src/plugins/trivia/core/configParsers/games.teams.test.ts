import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseTriviaGames } from "./games.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("parseTriviaGames — teams fields", () => {
  it("accepts the four teams fields and stores them on the game", () => {
    const { games, issues } = parseTriviaGames([
      {
        ...validBase,
        teams: [
          { name: "Red", userIds: ["U1", "U2"] },
          { name: "Blue", userIds: ["U3"] },
        ],
        teamsEnabled: true,
        teamsFinaleIndividuals: true,
        teamsScoring: "total-points",
      },
    ]);
    assert.equal(issues.length, 0);
    assert.deepEqual(games?.[0].teams, [
      { name: "Red", userIds: ["U1", "U2"] },
      { name: "Blue", userIds: ["U3"] },
    ]);
    assert.equal(games?.[0].teamsEnabled, true);
    assert.equal(games?.[0].teamsFinaleIndividuals, true);
    assert.equal(games?.[0].teamsScoring, "total-points");
  });

  it("drops an invalid roster (duplicate names) but the entry survives", () => {
    const { games, issues } = parseTriviaGames([
      {
        ...validBase,
        teams: [
          { name: "Red", userIds: ["U1"] },
          { name: "red", userIds: ["U2"] },
        ],
      },
    ]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].teams, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].teams");
    assert.match(issues[0].error, /duplicate team name/);
  });

  it("drops an invalid roster (user in two teams) but keeps sibling teams fields", () => {
    const { games, issues } = parseTriviaGames([
      {
        ...validBase,
        teams: [
          { name: "Red", userIds: ["U1"] },
          { name: "Blue", userIds: ["U1"] },
        ],
        teamsEnabled: true,
      },
    ]);
    assert.equal(games?.[0].teams, undefined);
    assert.equal(games?.[0].teamsEnabled, true);
    assert.equal(issues.length, 1);
    assert.match(issues[0].error, /at most one team/);
  });

  it("drops a non-boolean teamsEnabled with an issue", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, teamsEnabled: "yes" }]);
    assert.equal(games?.[0].teamsEnabled, undefined);
    assert.equal(issues[0].field, "trivia.games[0].teamsEnabled");
  });

  it("drops an unknown teamsScoring mode with an issue naming the valid ones", () => {
    const { games, issues } = parseTriviaGames([
      { ...validBase, teamsScoring: "winner-takes-all" },
    ]);
    assert.equal(games?.[0].teamsScoring, undefined);
    assert.equal(issues[0].field, "trivia.games[0].teamsScoring");
    assert.match(issues[0].error, /one-right-is-right/);
  });

  it("omits every teams field when none is set", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase }]);
    assert.equal(issues.length, 0);
    assert.equal("teams" in (games?.[0] ?? {}), false);
    assert.equal("teamsEnabled" in (games?.[0] ?? {}), false);
    assert.equal("teamsFinaleIndividuals" in (games?.[0] ?? {}), false);
    assert.equal("teamsScoring" in (games?.[0] ?? {}), false);
  });
});

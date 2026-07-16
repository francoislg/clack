import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createRetrieveScoresTool } from "./retrieveScores.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TeamDef, TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY = 86_400_000;

const ROSTER: TeamDef[] = [
  { name: "Red", userIds: ["U1", "U2"] },
  { name: "Blue", userIds: ["U3"] },
];

function getGamesWith(patch: Partial<TriviaGame>) {
  return () =>
    fixtureGetGames().map((g) => (g.name === FIXTURE_GAME_NAME ? { ...g, ...patch } : g));
}

async function seed(data: ReturnType<typeof createInMemoryDataLayer>): Promise<void> {
  const scoped = data.forGame(FIXTURE_GAME_NAME);
  await scoped.saveSeasonsState({
    seasons: [{ slug: "s1", startedAt: Date.now() - DAY, expectedEndAt: Date.now() + DAY }],
  });
  await scoped.saveAnswer({
    userId: "U1",
    questionId: "q1",
    answer: true,
    correct: true,
    timestamp: 1,
    season: "s1",
  });
  await scoped.saveAnswer({
    userId: "U2",
    questionId: "q1",
    answer: true,
    correct: true,
    timestamp: 2,
    season: "s1",
  });
}

describe("retrieve_scores — teams mode", () => {
  it("teams OFF: result carries no teamStandings key", async () => {
    const data = createInMemoryDataLayer();
    await seed(data);
    const tool = createRetrieveScoresTool(data, fixtureGetGames, () => ({}));
    const res = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: undefined },
        SESSION,
      ),
    );
    assert.equal("teamStandings" in res, false);
    assert.ok(res.leaderboard.length > 0);
  });

  it("teams ON: team standings ride alongside the unchanged individual leaderboard", async () => {
    const data = createInMemoryDataLayer();
    await seed(data);
    const tool = createRetrieveScoresTool(
      data,
      getGamesWith({ teams: ROSTER, teamsEnabled: true }),
      () => ({}),
    );
    const res = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: undefined },
        SESSION,
      ),
    );
    assert.equal(res.teamStandings.scoring, "one-right-is-right");
    assert.deepEqual(res.teamStandings.teams, [
      { name: "Red", currentSeason: 1 },
      { name: "Blue", currentSeason: 0 },
    ]);
    // Individual leaderboard is unchanged by teams mode.
    assert.equal(res.leaderboard.length, 2);
  });

  it("teams ON with prior stamped history: allTime appears per matched name", async () => {
    const data = createInMemoryDataLayer();
    await seed(data);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const state = await scoped.loadSeasonsState();
    assert.ok(state);
    state.seasons.unshift({
      slug: "s0",
      startedAt: Date.now() - 3 * DAY,
      expectedEndAt: Date.now() - 2 * DAY,
      endedAt: Date.now() - 2 * DAY,
      teamsStamp: {
        teams: [{ name: "red", userIds: ["U_OLD"] }],
        teamsScoring: "one-right-is-right",
      },
    });
    await scoped.saveSeasonsState(state);
    await scoped.saveAnswer({
      userId: "U_OLD",
      questionId: "q0",
      answer: true,
      correct: true,
      timestamp: 0,
      season: "s0",
    });

    const tool = createRetrieveScoresTool(
      data,
      getGamesWith({ teams: ROSTER, teamsEnabled: true }),
      () => ({}),
    );
    const res = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: undefined },
        SESSION,
      ),
    );
    const red = res.teamStandings.teams.find((t: { name: string }) => t.name === "Red");
    const blue = res.teamStandings.teams.find((t: { name: string }) => t.name === "Blue");
    assert.equal(red.allTime, 2);
    assert.equal("allTime" in blue, false);
  });
});

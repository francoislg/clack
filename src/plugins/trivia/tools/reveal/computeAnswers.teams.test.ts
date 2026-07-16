import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createComputeAnswersTool, type RevealSlackDeps } from "./computeAnswers.js";
import {
  createFakeSdk,
  createInMemoryDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
} from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaQuestion } from "../../core/types.js";
import type { TeamDef, TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY = 86_400_000;

const ROSTER: TeamDef[] = [
  { name: "Red", userIds: ["U_R1", "U_R2"] },
  { name: "Blue", userIds: ["U_B1"] },
];

function fakeSlackDeps(): RevealSlackDeps {
  return {
    isAvailable: () => null,
    fetchBotUserId: async () => "UBOT",
    fetchMessageReactions: async () => [],
    fetchUserDisplayName: async () => null,
    updateMessage: async () => {},
  };
}

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q1",
    category: "C",
    statement: "stmt",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    postedAt: 1000,
    messageLink: "https://x.slack.com/archives/C100000000/p1700000000000000",
    revealResponses: "yes",
    season: "s1",
    ...overrides,
  };
}

function toolWith(
  data: ReturnType<typeof createInMemoryDataLayer>,
  gamePatch: Partial<TriviaGame>,
  revealCron = "* * * * *",
) {
  const getGames = () =>
    fixtureGetGames().map((g) =>
      g.name === FIXTURE_GAME_NAME ? { ...g, revealCron, timezone: "UTC", ...gamePatch } : g,
    );
  return createComputeAnswersTool(data, createFakeSdk(), getGames, fakeSlackDeps(), () => ({}));
}

async function run(tool: ReturnType<typeof createComputeAnswersTool>) {
  return parseToolResult(
    await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined, reprocessBatchId: undefined },
      SESSION,
    ),
  );
}

async function seedRound(data: ReturnType<typeof createInMemoryDataLayer>): Promise<void> {
  const scoped = data.forGame(FIXTURE_GAME_NAME);
  await scoped.saveSeasonsState({
    seasons: [{ slug: "s1", startedAt: Date.now() - DAY, expectedEndAt: Date.now() + DAY }],
  });
  await scoped.saveQuestion(makeQuestion({}));
  await scoped.saveAnswer({
    userId: "U_R1",
    questionId: "q1",
    answer: true,
    correct: true,
    timestamp: 1,
    season: "s1",
  });
  await scoped.saveAnswer({
    userId: "U_R2",
    questionId: "q1",
    answer: false,
    correct: false,
    timestamp: 2,
    season: "s1",
  });
  await scoped.saveAnswer({
    userId: "U_B1",
    questionId: "q1",
    answer: false,
    correct: false,
    timestamp: 3,
    season: "s1",
  });
  await scoped.saveAnswer({
    userId: "U_FREE",
    questionId: "q1",
    answer: true,
    correct: true,
    timestamp: 4,
    season: "s1",
  });
}

describe("compute_answers — teams mode", () => {
  it("teams OFF: payload carries no team fields at all", async () => {
    const data = createInMemoryDataLayer();
    await seedRound(data);
    const res = await run(toolWith(data, {}));
    assert.equal("teamStandings" in res, false);
    assert.equal(res.reveals.length, 1);
    assert.equal("teamVoters" in res.reveals[0], false);
  });

  it("roster alone never activates (teamsEnabled unset)", async () => {
    const data = createInMemoryDataLayer();
    await seedRound(data);
    const res = await run(toolWith(data, { teams: ROSTER }));
    assert.equal("teamStandings" in res, false);
  });

  it("enabled with empty roster resolves OFF (no zero-team payload)", async () => {
    const data = createInMemoryDataLayer();
    await seedRound(data);
    const res = await run(toolWith(data, { teamsEnabled: true }));
    assert.equal("teamStandings" in res, false);
  });

  it("teams ON: payload carries teamStandings, free agents, and team-grouped voters", async () => {
    const data = createInMemoryDataLayer();
    await seedRound(data);
    const res = await run(toolWith(data, { teams: ROSTER, teamsEnabled: true }));

    assert.equal(res.teamStandings.scoring, "one-right-is-right");
    // Red (1 member correct → 1 pt) sorts above Blue (0 pts); no allTime (no prior stamp).
    assert.deepEqual(res.teamStandings.teams, [
      { name: "Red", thisRound: 1, currentSeason: 1 },
      { name: "Blue", thisRound: 0, currentSeason: 0 },
    ]);
    const freeAgentIds = res.teamStandings.freeAgents.map((f: { userId: string }) => f.userId);
    assert.deepEqual(freeAgentIds, ["U_FREE"]);
    assert.equal(res.teamStandings.freeAgents[0].thisRound, 1);
    assert.equal("finaleIndividuals" in res.teamStandings, false);

    const entry = res.reveals[0];
    assert.deepEqual(
      entry.teamVoters.correctTeams.map((t: { team: string }) => t.team),
      ["Red"],
    );
    assert.deepEqual(
      entry.teamVoters.incorrectTeams.map((t: { team: string }) => t.team),
      ["Blue"],
    );
    assert.equal(entry.teamVoters.correctFreeAgents.length, 1);
    assert.equal(entry.teamVoters.correctFreeAgents[0].userId, "U_FREE");
    // Individual voters remain in the payload for individual-data continuity.
    assert.equal(entry.voters.correct.length, 2);
  });

  it("total-points scoring pays each correct member through the strategy", async () => {
    const data = createInMemoryDataLayer();
    await seedRound(data);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveAnswer({
      userId: "U_R2",
      questionId: "q0",
      answer: true,
      correct: true,
      timestamp: 5,
      season: "s1",
    });
    const res = await run(
      toolWith(data, { teams: ROSTER, teamsEnabled: true, teamsScoring: "total-points" }),
    );
    assert.equal(res.teamStandings.scoring, "total-points");
    const red = res.teamStandings.teams.find((t: { name: string }) => t.name === "Red");
    assert.equal(red.currentSeason, 2);
  });

  it("all-time cell present only for a team name stamped in a prior season", async () => {
    const data = createInMemoryDataLayer();
    await seedRound(data);
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
      questionId: "q_old",
      answer: true,
      correct: true,
      timestamp: 0,
      season: "s0",
    });

    const res = await run(toolWith(data, { teams: ROSTER, teamsEnabled: true }));
    const red = res.teamStandings.teams.find((t: { name: string }) => t.name === "Red");
    const blue = res.teamStandings.teams.find((t: { name: string }) => t.name === "Blue");
    assert.equal(red.allTime, 2);
    assert.equal("allTime" in blue, false);
  });

  it("season-tier roster + enablement activates teams with a bare game (natural expiry path)", async () => {
    const data = createInMemoryDataLayer();
    await seedRound(data);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const state = await scoped.loadSeasonsState();
    assert.ok(state);
    state.seasons[0].teams = ROSTER;
    state.seasons[0].teamsEnabled = true;
    await scoped.saveSeasonsState(state);

    const res = await run(toolWith(data, {}));
    assert.equal(res.teamStandings.teams[0].name, "Red");
    assert.equal(res.reveals[0].teamVoters.correctTeams.length, 1);
  });

  it("a season disabling teams beats a game-tier enablement", async () => {
    const data = createInMemoryDataLayer();
    await seedRound(data);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const state = await scoped.loadSeasonsState();
    assert.ok(state);
    state.seasons[0].teamsEnabled = false;
    await scoped.saveSeasonsState(state);

    const res = await run(toolWith(data, { teams: ROSTER, teamsEnabled: true }));
    assert.equal("teamStandings" in res, false);
  });

  it("finaleIndividuals signals on the season's last fire when configured", async () => {
    const data = createInMemoryDataLayer();
    await seedRound(data);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const state = await scoped.loadSeasonsState();
    assert.ok(state);
    state.seasons[0].expectedEndAt = Date.now() + 60_000;
    await scoped.saveSeasonsState(state);

    const res = await run(
      toolWith(
        data,
        { teams: ROSTER, teamsEnabled: true, teamsFinaleIndividuals: true },
        "0 0 1 1 *",
      ),
    );
    assert.equal(res.seasonStatus.isLastFireOfSeason, true);
    assert.equal(res.teamStandings.finaleIndividuals, true);
  });
});

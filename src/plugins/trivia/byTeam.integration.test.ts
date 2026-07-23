import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createComputeAnswersTool } from "./tools/reveal/computeAnswers.js";
import { createTriviaDataLayer, FIXTURE_GAME_NAME } from "./testHelpers.js";
import {
  createFakeSdk,
  createFakeRevealSlackDeps,
  primeTriviaConfig,
} from "./testHelpers.fakeSdk.js";
import { parseToolResult } from "../../plugins-sdk/testHelpers.js";
import type { TriviaGame, TeamDef } from "./core/configTypes.js";
import type { TriviaQuestion } from "./core/types.js";

/**
 * END-TO-END shared-buzzer reveal: a byTeam-stamped question with two team members
 * (one overriding the other) and a free agent, scored by the REAL compute_answers
 * against a shared in-memory data layer. Asserts the whole seam composes: the team
 * earns ONE credit in standings, the free agent lands on the individual leaderboard,
 * and no synthetic `team:` row leaks onto the individual board.
 */

const SESSION = { sessionId: "test" };

const ROSTER: TeamDef[] = [
  { name: "Red", userIds: ["U1", "U2"] },
  { name: "Blue", userIds: ["U3"] },
];

const GAME: TriviaGame = {
  name: FIXTURE_GAME_NAME,
  channel: "C100000000",
  questionCron: "0 9 * * *",
  revealCron: "0 17 * * *",
  timezone: "UTC",
  enabled: true,
  teams: ROSTER,
  teamsEnabled: true,
  answeringType: "byTeam",
};

function byTeamQuestion(): TriviaQuestion {
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
    answeringType: "byTeam",
    teamsStamp: { teams: ROSTER },
  };
}

describe("byTeam reveal integration", () => {
  it("credits the team once, keeps the free agent individual, hides team rows from the board", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [GAME] });
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const deps = createFakeRevealSlackDeps({ fetchBotUserId: async () => "UBOT" });
    const getGames = () => [GAME];
    const compute = createComputeAnswersTool(data, sdk, getGames, deps, () => ({}));

    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(byTeamQuestion());

    // U1 answers wrong for Red, then U2 OVERRIDES with the correct answer (last-click-wins).
    await scoped.upsertTeamAnswer({
      teamName: "Red",
      questionId: "q1",
      answer: false,
      correct: false,
      lastAnsweredBy: "U1",
      timestamp: 1,
    });
    await scoped.upsertTeamAnswer({
      teamName: "Red",
      questionId: "q1",
      answer: true,
      correct: true,
      lastAnsweredBy: "U2",
      timestamp: 2,
    });
    // A free agent answers individually.
    await scoped.saveAnswer({
      userId: "U9",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 3,
    });

    const computed = parseToolResult(
      await compute.handler(
        { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined, reprocessBatchId: undefined },
        SESSION,
      ),
    );

    // Individual leaderboard: the free agent only — NO team rows, NO absorbed members.
    const boardIds = computed.leaderboard.map((e: { userId: string }) => e.userId).sort();
    assert.deepEqual(boardIds, ["U9"]);

    // Team standings: Red earned the point (via U2's overriding correct slot); Blue 0.
    assert.ok(computed.teamStandings, "teamStandings present when teams mode on");
    const red = computed.teamStandings.teams.find((t: { name: string }) => t.name === "Red");
    const blue = computed.teamStandings.teams.find((t: { name: string }) => t.name === "Blue");
    assert.equal(red.currentSeason, 1);
    assert.equal(blue.currentSeason, 0);

    // Exactly one slot survived the override.
    const slots = await scoped.loadTeamAnswers();
    assert.equal(slots.length, 1);
    assert.equal(slots[0].lastAnsweredBy, "U2");
  });
});

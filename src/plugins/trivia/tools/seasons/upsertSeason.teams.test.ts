import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { createListSeasonsTool } from "./listSeasons.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";
import type { TeamDef } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

const ROSTER: TeamDef[] = [
  { name: "Red", userIds: ["U1", "U2"] },
  { name: "Blue", userIds: ["U3"] },
];

type UpsertArgs = Parameters<ReturnType<typeof createUpsertSeasonTool>["handler"]>[0];

function makeArgs(overrides: Partial<UpsertArgs>): UpsertArgs {
  return {
    game: FIXTURE_GAME_NAME,
    slug: "s1",
    startedAt: undefined,
    expectedEndAt: undefined,
    endedAt: undefined,
    categories: undefined,
    answersFormat: undefined,
    questionType: undefined,
    promptMedium: undefined,
    freeformAnswerShape: undefined,
    contexts: undefined,
    difficulty: undefined,
    difficultyRatio: undefined,
    theme: undefined,
    format: undefined,
    slotOverrides: undefined,
    liveAnswersVisible: undefined,
    revealResponses: undefined,
    instructions: undefined,
    additionalInstructions: undefined,
    hint: undefined,
    judgeLeniency: undefined,
    choices: undefined,
    choiceEmojiStyle: undefined,
    points: undefined,
    teams: undefined,
    teamsEnabled: undefined,
    teamsFinaleIndividuals: undefined,
    teamsScoring: undefined,
    ...overrides,
  };
}

describe("upsert_season — teams fields", () => {
  let data: TriviaDataLayer;
  const future = Date.now() + 10 * DAY;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("create with teams fields persists and reports them", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = parseToolResult(
      await tool.handler(
        makeArgs({
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          teams: ROSTER,
          teamsEnabled: true,
          teamsScoring: "total-points",
          teamsFinaleIndividuals: true,
        }),
        SESSION,
      ),
    );
    assert.equal(result.action, "created");
    assert.equal(result.hasTeams, true);
    assert.equal(result.hasTeamsEnabled, true);
    assert.equal(result.hasTeamsScoring, true);
    assert.equal(result.hasTeamsFinaleIndividuals, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.deepEqual(state?.seasons[0].teams, ROSTER);
    assert.equal(state?.seasons[0].teamsEnabled, true);
    assert.equal(state?.seasons[0].teamsScoring, "total-points");
  });

  it("update: null clears one field, omit keeps siblings", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    await tool.handler(
      makeArgs({
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        teams: ROSTER,
        teamsEnabled: true,
      }),
      SESSION,
    );
    const result = parseToolResult(await tool.handler(makeArgs({ teamsEnabled: null }), SESSION));
    assert.equal(result.hasTeamsEnabled, false);
    assert.equal(result.hasTeams, true);
  });

  it("update rejects an invalid roster (duplicate names) without writing", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    await tool.handler(
      makeArgs({ startedAt: future, expectedEndAt: future + 30 * DAY, teams: ROSTER }),
      SESSION,
    );
    const result = parseToolResult(
      await tool.handler(
        makeArgs({
          teams: [
            { name: "Red", userIds: ["U1"] },
            { name: "red", userIds: ["U2"] },
          ],
        }),
        SESSION,
      ),
    );
    assert.match(result.error, /duplicate team name/);
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.deepEqual(state?.seasons[0].teams, ROSTER);
  });

  it("an update never drops an existing teamsStamp (internal close-time history)", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const stamp = {
      teams: [{ name: "Gold", userIds: ["U9"] }],
      teamsScoring: "one-right-is-right" as const,
    };
    await scoped.saveSeasonsState({
      seasons: [
        {
          slug: "s1",
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          teamsStamp: stamp,
        },
      ],
    });
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    await tool.handler(makeArgs({ theme: "New Theme" }), SESSION);
    const state = await scoped.loadSeasonsState();
    assert.deepEqual(state?.seasons[0].teamsStamp, stamp);
    assert.equal(state?.seasons[0].theme, "New Theme");
  });

  it("list_seasons projects the teams fields and teamsStamp present-iff-set", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const stamp = { teams: ROSTER, teamsScoring: "total-points" as const };
    await scoped.saveSeasonsState({
      seasons: [
        { slug: "plain", startedAt: 0, expectedEndAt: 1, endedAt: 1 },
        {
          slug: "teamsy",
          startedAt: 2,
          expectedEndAt: future,
          teams: ROSTER,
          teamsEnabled: true,
          teamsStamp: stamp,
        },
      ],
    });
    const tool = createListSeasonsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION));
    const plain = parsed.seasons.find((s: { slug: string }) => s.slug === "plain");
    const teamsy = parsed.seasons.find((s: { slug: string }) => s.slug === "teamsy");
    assert.equal("teams" in plain, false);
    assert.equal("teamsEnabled" in plain, false);
    assert.equal("teamsStamp" in plain, false);
    assert.deepEqual(teamsy.teams, ROSTER);
    assert.equal(teamsy.teamsEnabled, true);
    assert.deepEqual(teamsy.teamsStamp, stamp);
  });
});

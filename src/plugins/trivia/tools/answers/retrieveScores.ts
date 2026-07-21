import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import { createIndividualAnswering } from "../../answering/individual.js";
import { buildQuestionPointsMap, computeLeaderboard } from "../../domain/computeLeaderboard.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { resolveTeamsConfig } from "../../domain/teams/resolveTeamsConfig.js";
import { computeTeamStandings } from "../../domain/teams/computeTeamStandings.js";
import { computeTeamAllTime } from "../../domain/teams/allTime.js";
import type { TriviaDataLayer } from "../../core/types.js";

export function createRetrieveScoresTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
  getTriviaConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
) {
  return tool(
    "retrieve_scores",
    "Retrieve the trivia leaderboard for a specific game. When seasons are enabled, results include both current-season and all-time totals per user; use the season parameter to scope the leaderboard's primary ranking. When the game's effective teams mode is ON, the result additionally carries `teamStandings` — per team: `currentSeason` points (via the resolved scoring strategy) and `allTime` (present only when the team name matches prior seasons' stamped rosters) — alongside the unchanged individual leaderboard.",
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). Leaderboard is scoped to this game's answers only.",
        ),
      limit: z.number().optional().describe("Number of top scores to return (default: 10)"),
      sortBy: z
        .enum(["totalCorrect", "accuracy"])
        .optional()
        .describe(
          "Sort order. 'totalCorrect' (default): most wins first, accuracy as tiebreaker. 'accuracy': highest accuracy % first, totalCorrect as tiebreaker.",
        ),
      season: z
        .string()
        .optional()
        .describe(
          'Season filter. Default "current" (active season) when seasons are enabled, ignored when disabled. Accepts "all" (cross-season cumulative), or any historical season slug.',
        ),
    },
    async (args) => {
      try {
        requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const users = await data.loadUsers();
      const allAnswers = await createIndividualAnswering(scoped, data).getAllScoredAnswers();

      const currentSlug = await scoped.getCurrentSeasonSlug();
      const seasonsEnabled = currentSlug !== null;
      const seasonArg = args.season ?? (seasonsEnabled ? "current" : "all");

      const primaryFilterSeason: string | null =
        !seasonsEnabled || seasonArg === "all"
          ? null
          : seasonArg === "current"
            ? currentSlug
            : seasonArg;

      const questions = await scoped.loadQuestions();
      const { leaderboard, totalPlayers } = computeLeaderboard(
        allAnswers,
        users,
        buildQuestionPointsMap(questions),
        {
          sortBy: args.sortBy ?? "totalCorrect",
          limit: args.limit ?? 10,
          primaryFilterSeason,
          currentSeasonSlug: currentSlug,
        },
      );

      const gameEntry = getGamesFn().find((g) => g.name === args.game) ?? null;
      const seasonsState = await scoped.loadSeasonsState();
      const teamsConfig = resolveTeamsConfig(
        findCurrentSeason(seasonsState, Date.now()),
        gameEntry,
        getTriviaConfigFn(),
      );
      let teamStandings:
        | {
            scoring: string;
            teams: Array<{ name: string; currentSeason: number; allTime?: number }>;
          }
        | undefined;
      if (teamsConfig.enabled) {
        const questionPoints = buildQuestionPointsMap(questions);
        const seasonStandings = computeTeamStandings(
          allAnswers,
          teamsConfig.roster,
          teamsConfig.scoring,
          currentSlug,
          questionPoints,
        );
        const allTimeByName = computeTeamAllTime(
          allAnswers,
          seasonsState,
          teamsConfig.roster,
          teamsConfig.scoring,
          currentSlug,
          questionPoints,
        );
        teamStandings = {
          scoring: teamsConfig.scoring,
          teams: seasonStandings.map((s) => {
            const allTime = allTimeByName.get(s.name);
            return {
              name: s.name,
              currentSeason: s.points,
              ...(allTime !== undefined ? { allTime } : {}),
            };
          }),
        };
      }

      return textResult({
        leaderboard,
        totalPlayers,
        totalQuestions: questions.length,
        ...(seasonsEnabled ? { currentSeason: currentSlug, seasonFilter: seasonArg } : {}),
        ...(teamStandings !== undefined ? { teamStandings } : {}),
      });
    },
  );
}

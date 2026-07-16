# Add Trivia Teams

## Why

Trivia is strictly individual today — every answer, score, and leaderboard cell is keyed to one Slack user. Workspaces want team-based play (department vs department, cross-team mixers) where individual answers roll up into team standings. Admins need to define teams explicitly ("add Elton and Nick to Team Red for the game in channel X") without any opt-in flow, and switch a game or season into teams mode without touching how answers are recorded.

## What Changes

- **Four new cascading structural fields** on the season → game → workspace tiers (NOT `CascadeAxes` members — they are per-game policy like `theme`/`format`, not per-question axes):
  - `teams` — the roster: `Array<{ name: string; userIds: string[] }>`. Whole-roster replace per tier.
  - `teamsEnabled` — boolean policy toggle, default `false`. Roster presence NEVER activates teams by itself.
  - `teamsFinaleIndividuals` — boolean, default `false`; when `true` the season's last fire appends the classic individual leaderboard below the team tables.
  - `teamsScoring` — algorithm selector: `"one-right-is-right"` (default; per question, ≥1 member correct → 1 team point) or `"total-points"` (Σ of members' individual correct answers). Implemented as a pluggable strategy registry so new algorithms are one entry + test.
- **Team scoring is a pure projection** over the existing `answers.json` — no answer-schema change, no stamping on answers, no migration. Membership edits recompute retroactively ("teams are a layer above the points"). Free agents (players in no team) keep playing and scoring individually.
- **Season-close stamping**: when a season ends, the effective roster + `teamsScoring` mode are stamped onto the ending `SeasonEntry`, making ended seasons immune to later config edits and enabling deterministic team all-time.
- **Reveal surfaces switch to teams** when the effective `teamsEnabled` is true:
  - The 3-row standings table renders team columns first, then free-agent columns. The All Time row keeps its existing `allTimeRow` gating; a team's All Time cell renders ONLY when the same team name exists in prior seasons' stamped rosters (Σ of per-season team scores), otherwise the cell is empty.
  - Reveal footers and the Claude-authored narrative name teams instead of members (free agents still named individually); a team lands in the Correct bucket if ≥1 member was correct.
  - Live answer roster (while a question is open) stays individual — deliberately out of scope.
- **Admin surface**: `upsert_game`, `upsert_season`, and `set_workspace_config` gain the four fields with the standard null-to-clear / omit-to-keep semantics; shadowing detection applies. `list_games` / `list_seasons` surface them present-iff-set.

## Capabilities

### New Capabilities

- `trivia-teams`: team definitions (roster shape, cascade + precedence, enablement policy), team scoring strategies and the strategy registry, team standings computation (current season, this round, all-time via stamped season history), free-agent semantics, and season-close roster/mode stamping.

### Modified Capabilities

- `trivia-reveal-processor`: `compute_answers` payload gains `teamStandings`, team-grouped voter buckets, `teamsEnabled`/`teamsScoring` context, and finale-individuals signal.
- `trivia-reveal-cards`: reveal footer renders team names instead of member names when teams mode is on (bucket-by-team-verdict; free agents individual).
- `trivia-scheduled-prompts`: reveal prompt's leaderboard-table contract gains the teams-mode rendering rules (team columns first, per-cell All Time name-match, finale individual section).
- `trivia-management-tools`: `upsert_game` / `upsert_season` / `set_workspace_config` accept the four teams fields with null-clear/omit-keep semantics; `list_games` / `list_seasons` project them; `retrieve_scores` returns team standings alongside the individual leaderboard when teams mode is on.
- `trivia-seasons`: season close stamps the effective teams roster + scoring mode onto the ending `SeasonEntry`.

## Impact

- **New code**: `src/plugins/trivia/domain/teams/` (resolver, standings computation, scoring-strategy registry).
- **Modified code**: `core/configTypes.ts` + `core/types.ts` (tier types), `core/configParsers/` (games/seasons/workspace parsers), `tools/games/upsertGame.ts`, `tools/games/setWorkspaceConfig.ts`, `tools/seasons/upsertSeason.ts`, `tools/games/listGames.ts`, `tools/seasons/listSeasons.ts`, `tools/reveal/computeAnswers.ts`, `tools/answers/retrieveScores.ts` (team standings alongside the individual leaderboard when teams mode is on), `revealCards/footer.ts`, `prompts/scheduledPrompts.ts`, season-close path (`tools/reveal/rollover.ts` — reached by `start_new_season` and the season-end reveal).
- **Data**: `SeasonEntry` gains the four optional season-tier config fields plus an optional stamped `teamsStamp: { teams, teamsScoring }` object in `seasons.json` (graceful reader — absent on legacy rows). No changes to `answers.json`, `questions.json`, `users.json`. No migration.
- **Behavior when disabled**: `teamsEnabled` unset/false everywhere → observably identical to today.

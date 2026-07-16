# Tasks — add-trivia-teams

## 1. Types, defaults, and parsers

- [x] 1.1 Add `TeamDef` (`{ name: string; userIds: string[] }`), `TeamsScoringMode` (`"one-right-is-right" | "total-points"`), and the four optional fields (`teams`, `teamsEnabled`, `teamsFinaleIndividuals`, `teamsScoring`) — the field declarations on `TriviaGame` and `TriviaConfig` in `core/configTypes.ts` (where `TeamDef`/`TeamsScoringMode` also live), and on `SeasonEntry` in `core/types.ts` — with JSDoc noting they are structural-special (NOT `CascadeAxes` members)
- [x] 1.2 Add defaults (`DEFAULT_TEAMS_ENABLED = false`, `DEFAULT_TEAMS_SCORING = "one-right-is-right"`, `DEFAULT_TEAMS_FINALE_INDIVIDUALS = false`) alongside the existing structural defaults
- [x] 1.3 Add zod validators for the four fields to the games/seasons/workspace config parsers (lenient: malformed field dropped + issue logged, entry survives) including roster validation shape; unit tests for parser accept/drop cases
- [x] 1.4 Add optional stamped `teams` + `teamsScoring` fields to the persisted `SeasonEntry` seasons.json reader (graceful — legacy rows load unchanged); unit test with a legacy entry

## 2. Domain: resolver, strategies, standings

- [x] 2.1 Create `domain/teams/resolveTeamsConfig.ts`: independent first-wins resolution per field across `season → game → workspace → default`, returning the effective `{ enabled, roster, scoring, finaleIndividuals }` with the empty-roster-forces-off rule; unit tests covering each tier win, independence (season enables + workspace roster), and empty-roster-off (effective `teamsEnabled: true` with an empty/absent effective roster resolves to `enabled: false`)
- [x] 2.2 Create `domain/teams/scoring.ts`: `TeamScoringStrategy` interface + `TEAM_SCORING_REGISTRY` as a `Record<TeamsScoringMode, TeamScoringStrategy>` (compile-enforced exhaustiveness) with `one-right-is-right` and `total-points`; unit tests per strategy
- [x] 2.3 Create `domain/teams/computeTeamStandings.ts`: pure `(answers, roster, mode, filterSeason) → TeamStanding[]` reusing `computeLeaderboard`'s exclusion rules (pending freeform rows with `correct === undefined`, flagged cheaters, and the bot user); unit tests: retroactive membership, free agents excluded from team totals, per-question fold through strategy
- [x] 2.4 Create `domain/teams/allTime.ts`: name-match walk over ended seasons' stamped rosters/modes + live season, returning per-team all-time (absent when no prior-season match); unit tests: returning team accumulates, first-season team absent, rename severs history
- [x] 2.5 Roster write-time validation helper (empty/duplicate names, empty userIds, overlapping membership) shared by the three upsert tools; unit tests

## 3. Season-close stamping

- [x] 3.1 In `tools/reveal/rollover.ts` (`applySeasonRollover`, the one place that stamps `endedAt` on the closing season — reached by both `start_new_season` and the season-end reveal), stamp effective roster + `teamsScoring` onto the ending `SeasonEntry` when teams mode was effectively on (no stamp when off); idempotent re-stamp if absent
- [x] 3.2 Unit tests: stamp on close with teams on, no stamp when off, later config edits don't change ended-season scores, legacy entries unaffected

## 4. Reveal pipeline

- [x] 4.1 `tools/reveal/computeAnswers.ts`: resolve effective teams config live at reveal time; when on, add `teamStandings` (this-round + current-season + all-time), resolved `teamsScoring`, free-agent entries, and team-grouped voter buckets (Correct ≥1 member correct / Incorrect answered-none-right / NoAnswer nobody answered; members absorbed); byte-identical payload when off
- [x] 4.2 Add a `finaleIndividuals: true` field to the `compute_answers` result payload in `tools/reveal/computeAnswers.ts`, present only when teams mode is effectively ON, this is the season's last fire (existing `isLastFireBeforeSeasonEnd` gate), and effective `teamsFinaleIndividuals` is true
- [x] 4.3 `revealCards/footer.ts`: render team-grouped buckets (team names plain text, free agents via `renderPlayerRef` + stamped `tagPlayers`); freeform `revealResponses: "yes"` lists member texts unattributed under the team name
- [x] 4.4 Unit tests: teams-on payload shape, teams-off unchanged, mixed-team bucket verdicts, footer rendering with team + free agent, footer rendering when a roster references unknown user ids (raw-id fallback), freeform unattributed texts, live roster untouched

## 5. Prompt contract

- [x] 5.1 `prompts/scheduledPrompts.ts`: add the TEAMS MODE section per the trivia-scheduled-prompts delta spec — one table, team columns first (season points desc) then free agents, existing rows with `allTimeRow` gating, per-cell All Time empty when no name match, narrative names teams; finale appends the classic individual table when signaled

## 6. Admin tools

- [x] 6.1 `upsert_game` / `upsert_season` / `set_workspace_config`: accept the four fields with omit-keep / null-clear / validate-replace semantics (roster validator from 2.5; `teamsScoring` must be a registry mode); unit tests per tool per semantic
- [x] 6.2 Extend shadowing detection (`domain/shadowing.ts`) to the teams fields; unit test: game-tier roster write under a season roster returns `shadowedBy`
- [x] 6.3 `list_games` / `list_seasons`: project the four fields present-iff-set (per-game, per-season, `workspaceDefaults`) + the empty-roster-while-enabled warning; unit tests
- [x] 6.4 `tools/answers/retrieveScores.ts` (`retrieve_scores`): include team standings alongside the individual leaderboard when teams mode is on; unit test
- [x] 6.5 Update the trivia management admin instruction (`TRIVIA_MANAGEMENT_INSTRUCTION`): how to define rosters, enablement is explicit, season-scoped activation pattern ("teams for the next game in channel X" → set on current season), scoring modes, name-based team identity/rename caveat

## 7. Verification

- [x] 7.1 Integration test: full teams-mode round — roster + enablement on season, answers submitted, reveal computes team standings and grouped buckets, finale individuals appended
- [x] 7.2 Integration test: teams off everywhere → reveal payload and rendered surfaces identical to pre-feature snapshots (incl. prompt: no TEAMS MODE content when `teamStandings` is absent — the individual table contract is untouched)
- [x] 7.3 Run `npm run build`, `npm test`, `npx oxlint` / `npx oxfmt` on touched files
- [x] 7.4 Run `openspec validate add-trivia-teams --strict`

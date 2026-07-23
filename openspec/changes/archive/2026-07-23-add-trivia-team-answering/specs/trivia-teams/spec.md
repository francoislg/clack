# trivia-teams (delta)

## MODIFIED Requirements

### Requirement: Four independent teams fields cascade season → game → workspace

The trivia config SHALL support five OPTIONAL structural fields on `SeasonEntry`, `TriviaGame`, and `TriviaConfig`: `teams` (roster), `teamsEnabled` (boolean), `teamsFinaleIndividuals` (boolean), `teamsScoring` (mode string), and `answeringType` (`"individual" | "byTeam"`). Each field SHALL resolve independently first-wins across `season → game → workspace → default`, via a bespoke resolver in `domain/teams/` (NOT via `CascadeAxes` / `AXIS_REGISTRY` — these are structural-special fields with no slot tier).

#### Scenario: Season roster overrides game roster wholesale

- **WHEN** a game defines `teams` and its active season also defines `teams`
- **THEN** the season roster is used as-is (whole-roster replace) and the game roster is ignored

#### Scenario: Fields cascade independently

- **WHEN** a season sets only `teamsEnabled: true` and the workspace defines `teams`
- **THEN** the effective config is enabled with the workspace roster — the season's enablement does not mask the lower-tier roster

#### Scenario: Defaults when unset everywhere

- **WHEN** no tier sets any teams field
- **THEN** the resolved config is `teamsEnabled: false`, empty roster, `teamsScoring: "one-right-is-right"`, `teamsFinaleIndividuals: false`, `answeringType: "individual"`, and trivia behaves exactly as before this feature

### Requirement: Team standings are a pure projection over unchanged answers

For questions answered under INDIVIDUAL answering, `computeTeamStandings(answers, roster, mode, filterSeason)` SHALL compute team scores purely from existing `SubmittedAnswer` records — no fields are added to answer records and no team attribution is persisted onto them. It SHALL apply the same exclusions as `computeLeaderboard`: pending freeform rows (`correct === undefined`), flagged cheaters, and the bot user. For questions stamped `answeringType: "byTeam"`, team scores SHALL come from the team-answer slots instead (see `trivia-team-answering`); a mixed scope SHALL sum both paths per team.

#### Scenario: Membership edits recompute retroactively

- **WHEN** a free agent with prior correct answers this season is added to a team
- **THEN** the next computation credits the team for those individual-answering questions as if the player had been a member from the start, with no data backfill

#### Scenario: answers.json is untouched

- **WHEN** teams mode is enabled and individual-answering questions are answered and revealed
- **THEN** answer records are written in exactly the same shape as individual mode

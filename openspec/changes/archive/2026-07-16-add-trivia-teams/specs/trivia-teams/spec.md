# trivia-teams Specification

## ADDED Requirements

### Requirement: Four independent teams fields cascade season → game → workspace

The trivia config SHALL support four OPTIONAL structural fields on `SeasonEntry`, `TriviaGame`, and `TriviaConfig`: `teams` (roster), `teamsEnabled` (boolean), `teamsFinaleIndividuals` (boolean), and `teamsScoring` (mode string). Each field SHALL resolve independently first-wins across `season → game → workspace → default`, via a bespoke resolver in `domain/teams/` (NOT via `CascadeAxes` / `AXIS_REGISTRY` — these are structural-special fields with no slot tier).

#### Scenario: Season roster overrides game roster wholesale

- **WHEN** a game defines `teams` and its active season also defines `teams`
- **THEN** the season roster is used as-is (whole-roster replace) and the game roster is ignored

#### Scenario: Fields cascade independently

- **WHEN** a season sets only `teamsEnabled: true` and the workspace defines `teams`
- **THEN** the effective config is enabled with the workspace roster — the season's enablement does not mask the lower-tier roster

#### Scenario: Defaults when unset everywhere

- **WHEN** no tier sets any teams field
- **THEN** the resolved config is `teamsEnabled: false`, empty roster, `teamsScoring: "one-right-is-right"`, `teamsFinaleIndividuals: false`, and trivia behaves exactly as before this feature

### Requirement: Roster presence never activates teams mode

`teamsEnabled` SHALL default to `false`, and a roster defined at any tier SHALL be inert until some tier explicitly sets `teamsEnabled: true`. An effective `teamsEnabled: true` with an EMPTY effective roster SHALL resolve to teams mode OFF.

#### Scenario: Workspace roster with no enablement

- **WHEN** the workspace defines `teams` but no tier sets `teamsEnabled`
- **THEN** every game plays individual trivia, unchanged

#### Scenario: Enabled with empty effective roster resolves off

- **WHEN** effective `teamsEnabled` is `true` but the effective roster is empty or absent
- **THEN** teams mode is OFF for that game (no zero-team reveal) and the `list_games` projection surfaces a warning for the misconfiguration

### Requirement: Roster shape and validation

A roster SHALL be `Array<{ name: string; userIds: string[] }>` storing Slack user ids only (display names are resolved at render time from the central users registry). At write time the system SHALL reject: empty team names, duplicate team names (case-insensitive — `"Red"` and `"red"` collide), empty `userIds` arrays, and a user id appearing in more than one team of the same roster.

#### Scenario: Overlapping membership rejected

- **WHEN** an admin writes a roster where the same user id appears in two teams
- **THEN** the write fails with an error naming the duplicated user

#### Scenario: Duplicate team names rejected case-insensitively

- **WHEN** an admin writes a roster containing teams named `"Red"` and `"red"`
- **THEN** the write fails with an error naming the colliding team name

#### Scenario: Unknown users render gracefully

- **WHEN** a roster references a user id with no entry in the users registry
- **THEN** scoring counts their answers normally and rendering falls back to the raw id

### Requirement: Team scoring strategy registry

Team scoring SHALL be implemented as a registry `Record<TeamsScoringMode, TeamScoringStrategy>` where each strategy exposes `scoreQuestion(memberAnswers, questionPoints) → number` (`questionPoints` = the question's stamped worth, 1 unless the points axis raised it — team scoring is points-aware, consistent with points-primary individual scoring). The mapped type SHALL make a mode without a strategy a compile error. `memberAnswers` is the filtered list of SCORED answers to one question from that team's members — pending freeform rows (`correct === undefined`), cheater rows, and the bot are already excluded by the caller; a member who did not answer contributes no element. When no member answered, `memberAnswers` is an empty array (every launch strategy returns 0 for it). Launch modes: `"one-right-is-right"` (per question: ≥1 member correct → the question's points, i.e. 1 on an ordinary question; default) and `"total-points"` (per question: Σ over correct members of the question's points, i.e. the count of correct member answers on ordinary questions). Consumers SHALL NOT branch on the mode value outside the registry.

#### Scenario: one-right-is-right scores at most one point per question

- **WHEN** three members of a team answer a question correctly under `"one-right-is-right"`
- **THEN** the team earns exactly 1 point for that question

#### Scenario: total-points sums member correctness

- **WHEN** three members of a team answer a question correctly under `"total-points"`
- **THEN** the team earns 3 points for that question

#### Scenario: New mode requires a registry entry

- **WHEN** a new `TeamsScoringMode` value is added without a corresponding registry entry
- **THEN** compilation fails

### Requirement: Team standings are a pure projection over unchanged answers

`computeTeamStandings(answers, roster, mode, filterSeason)` SHALL compute team scores purely from existing `SubmittedAnswer` records — no fields are added to answer records and no team attribution is persisted. It SHALL apply the same exclusions as `computeLeaderboard`: pending freeform rows (`correct === undefined`), flagged cheaters, and the bot user.

#### Scenario: Membership edits recompute retroactively

- **WHEN** a free agent with prior correct answers this season is added to a team
- **THEN** the next computation credits the team as if the player had been a member from the start, with no data backfill

#### Scenario: answers.json is untouched

- **WHEN** teams mode is enabled and questions are answered and revealed
- **THEN** answer records are written in exactly the same shape as individual mode

### Requirement: Free agents play individually alongside teams

Players not present in any team of the effective roster SHALL continue to answer, score, and appear as individuals on every teams-mode surface. Individual scoring data SHALL remain available regardless of teams mode (`retrieve_scores` continues to serve the individual leaderboard).

#### Scenario: Free agent in the standings table

- **WHEN** the reveal standings render with teams mode on and a non-team player answered this season
- **THEN** that player gets their own column after the team columns, with their individual counts

### Requirement: Team all-time by exact name match over stamped season history

A team's all-time score SHALL be the sum of its per-season scores across ended seasons whose STAMPED roster contains the same team name (case-insensitive match — consistent with the duplicate-name validation rule, so a casing-only re-entry like `"Red"` → `"red"` does NOT sever history), each ended season scored with its stamped roster and stamped scoring mode, plus the live season scored with the live effective roster and mode. A team whose name appears in no prior stamped roster SHALL have no all-time value (its All Time cell renders empty).

#### Scenario: Returning team accumulates

- **WHEN** "Red" exists in the stamped roster of one ended season (score 17) and in the live season (score 14)
- **THEN** Red's all-time is 31

#### Scenario: First-season team has no all-time

- **WHEN** a team name appears only in the live season's roster
- **THEN** its All Time cell is empty while other columns' All Time cells still render

#### Scenario: Renaming severs history

- **WHEN** a team is renamed between seasons (beyond a casing-only change)
- **THEN** the new name starts with no all-time history (name match is the only identity)

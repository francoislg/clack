# trivia-reveal-processor Delta

## ADDED Requirements

### Requirement: Reveal payload carries team standings and team-grouped voters when teams mode is on

`compute_answers` SHALL resolve the effective teams config live at reveal time (same pattern as `tagPlayers`). When teams mode is effectively ON, the payload SHALL additionally include: `teamStandings` (per team: this-round points, current-season points, and all-time points when the team name matches prior stamped rosters), the resolved `teamsScoring` mode, free-agent individual entries, and a `finaleIndividuals: true` signal on the season's last fire when effective `teamsFinaleIndividuals` is `true`. "Last fire" SHALL be determined by the existing season-status mechanism (`isLastFireBeforeSeasonEnd`: the game's next `revealCron` fire lands after the season's `expectedEndAt`) — the same gate that drives the `allTimeRow` end-of-season surface — evaluated at reveal time, so an `expectedEndAt` edit between question and reveal is honored by the reveal. When teams mode is OFF, the payload SHALL be byte-identical to pre-feature behavior.

#### Scenario: Teams-on payload

- **WHEN** `compute_answers` runs for a game whose effective `teamsEnabled` is `true` with a non-empty roster
- **THEN** the result includes `teamStandings` computed via the resolved scoring strategy, alongside the existing individual `leaderboard`

#### Scenario: Teams-off payload unchanged

- **WHEN** `compute_answers` runs with teams mode off
- **THEN** no team fields appear in the payload

#### Scenario: Finale individuals signal

- **WHEN** the reveal is the season's last fire and effective `teamsFinaleIndividuals` is `true`
- **THEN** the payload instructs the prompt to append the classic individual leaderboard below the team tables

### Requirement: Voter buckets group by team verdict

When teams mode is ON, each reveal entry's voter buckets SHALL present teams instead of member names: a team appears in the Correct bucket when ≥1 member answered correctly, in the Incorrect bucket when members answered but none correctly, and in the NoAnswer bucket when no member answered. Members are absorbed into the team name and never listed alongside it. Free agents SHALL remain individual entries in the buckets.

#### Scenario: Mixed team lands in Correct

- **WHEN** one member of a team answers correctly and two answer incorrectly
- **THEN** the team appears once, in the Correct bucket, and none of its members are named

#### Scenario: Free agent buckets unchanged

- **WHEN** a player in no team answers incorrectly
- **THEN** they are named individually in the Incorrect bucket exactly as today

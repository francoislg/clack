# trivia-seasons Delta

## ADDED Requirements

### Requirement: Season close stamps the effective teams roster and scoring mode

When a season ends (via `start_new_season` or the season-end path), and teams mode was effectively ON for the game, the system SHALL stamp the effective roster and effective `teamsScoring` onto the ending `SeasonEntry` in `seasons.json` as a single `teamsStamp: { teams, teamsScoring }` object — DISTINCT from the season-TIER config fields (`SeasonEntry.teams` etc. are one cascade tier's input; the stamp is the resolved output frozen for history, so a season-tier roster on an ended season where teams mode was OFF is never mistaken for team history). Ended seasons SHALL be scored from their stamp, immune to later config edits; the live season SHALL always be scored from live effective config. `teamsStamp` is OPTIONAL on `SeasonEntry` (graceful reader — legacy rows simply carry no team history).

#### Scenario: Stamp written at close when teams were on

- **WHEN** a season with effective `teamsEnabled: true` is closed
- **THEN** the ending `SeasonEntry` persists the effective roster and scoring mode as of close time

#### Scenario: No stamp when teams were off

- **WHEN** a season with teams mode off is closed
- **THEN** no teams fields are stamped on the ending entry

#### Scenario: Later config edits do not rewrite history

- **WHEN** an admin changes the game roster or `teamsScoring` after a season closed
- **THEN** the ended season's team scores (as used by all-time) are computed from its stamp, unchanged

#### Scenario: Legacy season entries load unchanged

- **WHEN** `seasons.json` contains entries without stamped teams fields
- **THEN** they load without error and contribute no team history

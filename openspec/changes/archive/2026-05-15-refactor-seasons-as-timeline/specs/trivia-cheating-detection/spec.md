## MODIFIED Requirements

### Requirement: Save Cheating Tool

The Trivia plugin SHALL expose a `save_cheating` MCP tool that records a cheat attempt against a user, increments the user's cheat counter, and signals the caller to notify the owner.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, each new entry written to `cheats.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (gap), no `season` field is written on new cheat entries.

The `cheatAttempts` counter on the user record continues to be cumulative across seasons (it is not reset by `upsert_season` or by the natural timeline progression). All other behaviors (role gating, hidden-from-task-cards, owner DM via SDK) are preserved.

#### Scenario: New cheat carries the active season's tag

- **GIVEN** the currently-active season's slug is `"may-2026"`
- **WHEN** `save_cheating` records a cheat
- **THEN** the new entry in `cheats.json` includes `season: "may-2026"`

#### Scenario: cheatAttempts persists across timeline transitions

- **GIVEN** user U123 has `cheatAttempts: 4` accumulated from prior seasons
- **AND** the active season has changed to a new entry since their last offense
- **WHEN** `save_cheating` is called with `cheaterUserId: "U123"`
- **THEN** the user's `cheatAttempts` becomes `5`
- **AND** the new cheat entry is tagged with the new active season's slug

#### Scenario: Cheats written during a gap have no season tag

- **GIVEN** `findCurrentSeason` returns `null`
- **WHEN** `save_cheating` records a cheat
- **THEN** the new entry contains no `season` field
- **AND** the user's `cheatAttempts` is still incremented

### Requirement: Cheat Report Log

The Trivia plugin SHALL maintain a `cheats.json` file in its plugin data directory, storing the full list of cheat reports as an append-only array.

Each entry SHALL contain `cheaterUserId`, `questionId`, `reason`, optional `evidence`, and `detectedAt` (ISO 8601 timestamp). When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season at write time, each entry SHALL also contain `season` (string, the active season's slug). When seasons are disabled or in a gap, no `season` field is written.

Other behaviors (append-only, file creation on first write, parent-directory creation) are preserved.

#### Scenario: New cheat entry includes season when the timeline has a current season

- **GIVEN** `trivia.seasons.enabled` is `true` and the currently-active season's slug is `"may-2026"`
- **WHEN** `save_cheating` appends a new entry to `cheats.json`
- **THEN** the entry's `season` field equals `"may-2026"`

#### Scenario: New cheat entry omits season during a gap

- **GIVEN** `findCurrentSeason(state, now)` returns `null`
- **WHEN** `save_cheating` appends a new entry
- **THEN** the entry contains no `season` field

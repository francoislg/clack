## ADDED Requirements

### Requirement: Apply-to-current-season clears the override

When an admin confirms that a shadowed game edit should take effect in the current season, the resolution SHALL CLEAR the season's override(s) for the confirmed field(s) (`upsert_season(slug, { <field>: null, ... })`) so they fall through to the new game value, rather than copying the game value into the season. This keeps the season holding only genuine season-specific deltas and prevents the season from silently drifting from the game on subsequent game edits. When multiple fields are shadowed, all the admin-confirmed fields MAY be cleared in a single `upsert_season` call. The clear SHALL only happen on explicit admin confirmation and SHALL target the season that is current at apply time; if the season has since ended, been deleted, or changed, the standard `upsert_season` validation applies (the clear errors or no-ops rather than mutating the wrong season).

#### Scenario: Confirmed apply clears the season override

- **WHEN** `upsert_game` reports `answersFormat` shadowed by the active season and the admin confirms "yes, apply to this season too"
- **THEN** Claude calls `upsert_season(slug, { answersFormat: null })`, and the next resolution for that season returns the game's value at tier `game`

#### Scenario: Multiple shadowed fields clear together

- **WHEN** `upsert_game` reports both `answersFormat` and `format` shadowed and the admin confirms applying both
- **THEN** Claude clears both in one call — `upsert_season(slug, { answersFormat: null, format: null })`

#### Scenario: Declining leaves the season override intact

- **WHEN** the admin declines to apply the change to the current season
- **THEN** the season override is left unchanged and the game edit takes effect only once the season ends (the next season inherits the new game value)

### Requirement: Sparse-season write philosophy generalized

The "omit to inherit from the game / global cascade" principle SHALL apply to EVERY cascading axis and `format`, not only `categories`. A season SHALL hold a field only when that field is an intentional season-specific override; absent fields inherit from the game tier. The admin instruction SHALL reflect that Clack almost never writes a season override unprompted — game configuration is authoritative and the season carries deltas.

#### Scenario: Non-scoped axis change does not write the season

- **WHEN** an admin changes a game's difficulty with no season qualifier while a season is active but does not override difficulty
- **THEN** only the game tier is written; the season remains free of a difficulty override and continues to inherit

#### Scenario: Season created without redundant fields

- **WHEN** a new season is created for a non-themed period
- **THEN** it is written without axis/format fields that merely duplicate the game, so it inherits them via the cascade

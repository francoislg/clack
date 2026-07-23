# trivia-management-tools (delta)

## ADDED Requirements

### Requirement: Admin tools accept and surface answeringType

`upsert_game`, `upsert_season`, and `set_workspace_config` SHALL accept `answeringType: "individual" | "byTeam" | null` with the standard omit-to-keep / null-to-clear semantics and shadowing detection. `list_games` and `list_seasons` SHALL surface the field present-iff-set, and `list_games` SHALL emit a warning when the resolved `answeringType` is `"byTeam"` but inert (teams disabled or empty roster), plus a divergence note when live byTeam questions carry a stamp differing from current config.

#### Scenario: Setting byTeam on a game

- **WHEN** an admin runs `upsert_game` with `answeringType: "byTeam"` on a game whose teams config is enabled with a roster
- **THEN** the field persists at the game tier and subsequent `post_questions` fires stamp `"byTeam"`

#### Scenario: Inert warning surfaces

- **WHEN** `list_games` runs for a game resolving `answeringType: "byTeam"` with an empty effective roster
- **THEN** the entry carries a warning naming the inert `answeringType` and the missing precondition

#### Scenario: Clearing answeringType with null

- **WHEN** an admin runs `upsert_game` with `answeringType: null` on a game where it was previously `"byTeam"`
- **THEN** the game-tier field is removed, subsequent `post_questions` fires resolve `answeringType` from the remaining tiers (or the `"individual"` default), and `list_games` no longer surfaces the field for that game

#### Scenario: Shadowing detection on a masked write

- **WHEN** an admin sets `answeringType` at the game tier while the active season already sets `answeringType`
- **THEN** `upsert_game` persists the game value and returns a `shadowedBy` note stating the season tier masks it, per the existing shadowing-detection mechanism

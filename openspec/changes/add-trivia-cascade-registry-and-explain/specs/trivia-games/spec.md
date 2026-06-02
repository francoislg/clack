## ADDED Requirements

### Requirement: list_games surfaces every registry axis

The `list_games` tool SHALL project its per-game `axisOverrides` and top-level `workspaceDefaults` from the shared `AXIS_REGISTRY` rather than a hand-maintained field list, so that every cascading axis present in the registry is surfaced. In particular `promptMedium` SHALL appear in `axisOverrides` when set on a game and in `workspaceDefaults` when set at the workspace tier (closing the prior omission). The present-iff-set rule is unchanged: an axis field appears for a game only when that game's entry literally set it, and in `workspaceDefaults` only when the workspace tier set it.

#### Scenario: promptMedium surfaces at the game tier

- **WHEN** a game sets `promptMedium` and a `member`+ user calls `list_games`
- **THEN** that game's `axisOverrides` includes `promptMedium` with the configured value

#### Scenario: promptMedium surfaces at the workspace tier

- **WHEN** the workspace tier sets `promptMedium` and a `member`+ user calls `list_games`
- **THEN** the response's `workspaceDefaults` includes `promptMedium`

#### Scenario: New axes surface without editing list_games

- **WHEN** a future cascading axis is added to `CascadeAxes` and `AXIS_REGISTRY`
- **THEN** `list_games` surfaces it in `axisOverrides` and `workspaceDefaults` with no edit to `list_games` itself

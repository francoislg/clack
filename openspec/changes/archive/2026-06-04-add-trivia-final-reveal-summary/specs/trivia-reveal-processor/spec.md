## ADDED Requirements

### Requirement: `compute_answers` resolves and returns `finalRevealSummary`

`compute_answers` SHALL resolve `resolveFinalRevealSummary(game, workspace)` (cascade `game → workspace → "yes"`) at reveal time — NOT from any stamped per-question value — and SHALL include the resolved value as a top-level `finalRevealSummary: "yes" | "no" | "in-thread"` field in its returned payload, present in every payload including empty-reveal payloads.

#### Scenario: Payload carries resolved value

- **GIVEN** a game resolving `finalRevealSummary: "in-thread"`
- **WHEN** `compute_answers({ game })` returns
- **THEN** the payload's top-level `finalRevealSummary` is `"in-thread"`

#### Scenario: Default surfaces when unset

- **GIVEN** a game with the axis unset at game and workspace tiers
- **WHEN** `compute_answers({ game })` returns
- **THEN** the payload's `finalRevealSummary` is `"yes"`

#### Scenario: Resolved fresh, not stamped

- **GIVEN** a question posted while the game resolved `"yes"`, then the game's axis is changed to `"no"` before reveal
- **WHEN** `compute_answers` runs the reveal
- **THEN** the payload's `finalRevealSummary` is `"no"`

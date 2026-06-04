## ADDED Requirements

### Requirement: `compute_answers` resolves and returns `includeRevealInQuestions`

`compute_answers` SHALL resolve `resolveIncludeRevealInQuestions(game, workspace)` (cascade `game → workspace → "no"`) at reveal time — NOT from any stamped per-question value — and SHALL include the resolved value as a top-level `includeRevealInQuestions: "yes" | "no"` field in its returned payload, present in every payload including empty-reveal payloads.

#### Scenario: Payload carries resolved value

- **GIVEN** a game resolving `includeRevealInQuestions: "yes"`
- **WHEN** `compute_answers({ game })` returns
- **THEN** the payload's top-level `includeRevealInQuestions` is `"yes"`

#### Scenario: Default surfaces when unset

- **GIVEN** a game with the axis unset at game and workspace tiers
- **WHEN** `compute_answers({ game })` returns
- **THEN** the payload's `includeRevealInQuestions` is `"no"`

#### Scenario: Resolved fresh, not stamped

- **GIVEN** a question posted while the game resolved `"no"`, then the game's axis is changed to `"yes"` before reveal
- **WHEN** `compute_answers` runs the reveal
- **THEN** the payload's `includeRevealInQuestions` is `"yes"`

## REMOVED Requirements

### Requirement: DM Opt-Out Preference
**Reason**: The `dmOptOut` boolean preference is replaced by a positive `reactionDelivery` preference. The opt-out framing no longer makes sense without ephemeral as the default.
**Migration**: Boot migration converts existing preferences: `dmOptOut: true` → `reactionDelivery: "thread"`, `dmOptOut: false` (or absent) → `reactionDelivery: "dm"`.

## ADDED Requirements

### Requirement: Reaction Delivery Preference
Allow users to choose how reaction-triggered answers are delivered: via DM or directly in the channel thread.

#### Scenario: Preference values
- **WHEN** a user sets their reaction delivery preference
- **THEN** the value SHALL be one of `"dm"` or `"thread"`

#### Scenario: Default preference
- **WHEN** a user has no `reactionDelivery` preference set
- **THEN** the system defaults to `"dm"`

#### Scenario: DM delivery selected
- **WHEN** a user's `reactionDelivery` is `"dm"`
- **THEN** reaction-triggered answers are delivered in a private DM thread

#### Scenario: Thread delivery selected
- **WHEN** a user's `reactionDelivery` is `"thread"`
- **THEN** reaction-triggered answers are posted visibly in the channel thread where the reaction was added

#### Scenario: Preference respected immediately
- **WHEN** a user changes their `reactionDelivery` preference
- **THEN** the next reaction-triggered answer uses the new preference

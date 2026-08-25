## ADDED Requirements

### Requirement: Tripped-breaker work fires early-exit near-free

When the `list_top_ideas` result reports `nightBreaker.tripped: true`, the work fire SHALL end immediately via skip — no `record_fire_outcome` call, no `attach_integration`, no ledger writes, no further tool calls. The early-exit is a prompt contract over the unchanged cron layout (no cron mutation mid-night, no spec pause). The contract fails open: a fire that ignores the flag proceeds as a normal cheap-first fire, costing the ordinary empty-fire price with no correctness impact.

#### Scenario: Tripped fire ends in two turns

- **GIVEN** the breaker is tripped for the current window
- **WHEN** a work fire runs
- **THEN** it calls `list_top_ideas`, observes `nightBreaker.tripped: true`, and ends via skip with no other tool calls

#### Scenario: Cron layout is untouched while tripped

- **GIVEN** the breaker is tripped mid-window
- **WHEN** subsequent work slots arrive
- **THEN** each fire still spawns and early-exits — no cron job is paused, mutated, or removed

#### Scenario: Ignoring the flag fails open

- **GIVEN** the breaker is tripped but the fire proceeds past the flag
- **WHEN** the fire runs the cheap-first path
- **THEN** it behaves as an ordinary empty fire (ledger check, empty record, skip) with no incorrect action taken

### Requirement: The breaker never starves the idler's own async loops

A work fire that posts an `@claude review this` trigger SHALL record it via `record_fire_outcome({ outcome: "async-triggered", asyncKey })` instead of an empty outcome. While any async trigger is pending, empty fires SHALL NOT advance the breaker toward a trip, so the fire that later reads the review result always gets to run at full capability.

#### Scenario: Trigger fire records async, not empty

- **GIVEN** a work fire whose only action is posting a review trigger on a PR
- **WHEN** the fire ends
- **THEN** it records `outcome: "async-triggered"` with the PR's key and the empty counter does not advance

#### Scenario: Follow-up fire runs at full capability

- **GIVEN** a pending async trigger and enough empty fires that the breaker would otherwise have tripped
- **WHEN** the review result arrives and the next work fire runs
- **THEN** the fire is not early-exited and processes the review as continue work

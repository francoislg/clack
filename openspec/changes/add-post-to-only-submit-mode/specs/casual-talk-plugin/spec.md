## MODIFIED Requirements

### Requirement: Cron Spec Assembly (Channelless)

The plugin SHALL produce exactly one `CronJobSpec` and reconcile it via `sdk.reconcileCronJobs("casual-talk", [spec])` whenever its config is loaded or mutated. The spec SHALL be channelless (no `channel` field — depends on `channelless-cron-jobs`). When `config.enabled === false`, the plugin SHALL reconcile with `[]` so any previously-reconciled spec is removed.

The spec SHALL set:

- `specKey: "chatter"`
- `cronExpression`: from the cron-expression builder
- `timezone`: from `workHours.tz`
- `submitResponseMode`: `"optional-post-to"`
- `requiredTools`: `["mcp__clack__random_roll"]`
- `attachedTopics`: `["casual-talk"]`
- `prompt`: the assembled prompt (see "Prompt Assembly")
- `name`: a short human-readable label (e.g., `"Casual chatter"`)

The `"optional-post-to"` mode (not `"skipped"`) is REQUIRED so the run can deliver via `post_to`: casual-talk's deliverable is a `post_to` action to a runtime-chosen channel, and `"skipped"` would strip the `actions` field, leaving the run with no delivery path. This resolves the prior contradiction between the declared mode and the mandated `post_to` delivery. (Channelless runs are mechanically forced to `"optional-post-to"` regardless — see `submit-response-mode` — so this declaration documents intent and stays correct if the channelless rule is ever scoped differently.)

#### Scenario: Reconcile with enabled config creates one channelless spec

- **GIVEN** a valid config with `enabled: true` and at least one channel
- **WHEN** the plugin runs reconciliation
- **THEN** exactly one cron spec is reconciled
- **AND** the spec's `channel` field is omitted
- **AND** the spec's `attachedTopics` is `["casual-talk"]`
- **AND** the spec's `submitResponseMode` is `"optional-post-to"`
- **AND** the spec's `requiredTools` includes `mcp__clack__random_roll`

#### Scenario: Disabled config removes any prior spec

- **GIVEN** a previously-reconciled casual-talk cron job exists
- **WHEN** the plugin reconciles with `config.enabled: false`
- **THEN** `sdk.reconcileCronJobs("casual-talk", [])` is called
- **AND** the prior cron job is removed

#### Scenario: Casual-talk run delivers via post_to

- **GIVEN** an enabled casual-talk channelless run that rolls a hit and chooses a destination channel
- **WHEN** Claude calls `submit_response` with a `post_to` action targeting that channel
- **THEN** the `optional-post-to` schema accepts the call
- **AND** the message is posted to the chosen channel
- **AND** the run is recorded as a successful delivery

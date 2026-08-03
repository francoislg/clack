# slack-message-trigger Delta

## ADDED Requirements

### Requirement: Followed-thread event routing

When `config.investigations.enabled` is true, the message-event pipeline SHALL match each incoming channel message against the open-investigations index by `(channel, thread_ts)` and tee matches to the investigation follow pipeline. The tee SHALL be non-destructive: every existing consumer of the event (auto-respond resolution, mention handling, stop detection) SHALL observe the event unchanged and in the same order as without the feature. When the feature is disabled the routing step SHALL be absent entirely.

#### Scenario: Non-matching events pay only an index lookup

- **WHEN** a message event arrives for a thread not in the open index
- **THEN** the follow pipeline is not invoked
- **AND** normal handling proceeds unchanged

#### Scenario: Matching events reach both pipelines

- **WHEN** a message event arrives for a followed thread
- **THEN** the follow pipeline receives it
- **AND** auto-respond/mention handling for that event is unaffected

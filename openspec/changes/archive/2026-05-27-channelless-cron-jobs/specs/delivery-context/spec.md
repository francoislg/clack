## ADDED Requirements

### Requirement: Scheduled-Channelless Delivery Context

The system SHALL describe a distinct delivery-context mode for `triggerType === "scheduled"` runs whose underlying cron job has no bound channel. The context SHALL state explicitly that `submit_response` cannot deliver text (the schema is mechanically restricted to `skip_response: true`) and that the only delivery path is the `post_to` action with an explicit `channel` argument.

The context SHALL be descriptive, not prescriptive — it informs Claude about available actions for this run but does not script the decision.

#### Scenario: Scheduled trigger with no channel

- **WHEN** building delivery context for a `scheduled` trigger whose cron job has no `channel`
- **THEN** the delivery context describes Scheduled-Channelless mode
- **AND** the context states that `submit_response` is a run terminator only (the schema accepts only `{ skip_response: true }`)
- **AND** the context lists `post_to {channel, text}` as the available delivery action
- **AND** the context states that a run with no `post_to` followed by `skip_response: true` is a legitimate "decided not to post" outcome

#### Scenario: Scheduled trigger with a channel uses the original Scheduled mode

- **WHEN** building delivery context for a `scheduled` trigger whose cron job has `channel: "C123"`
- **THEN** the delivery context describes the channel-bound Scheduled mode (the pre-channelless behavior)
- **AND** the context does NOT include the Scheduled-Channelless language

#### Scenario: Channelless context lists candidate-channel cues from the prompt

- **WHEN** the prompt embeds a list of candidate channels (as the `casual-talk` plugin does)
- **THEN** the delivery context still describes Scheduled-Channelless mode at the framework level
- **AND** Claude reads the candidate list from the prompt (NOT from the delivery context, which is framework-level only)

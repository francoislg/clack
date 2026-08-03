# delivery-context Specification

## Purpose
Derive delivery context from the session's persisted state and pass it to Claude so it can make informed decisions about which actions to include in responses.

## Requirements

### Requirement: Delivery Context in Claude Prompt
The system SHALL include delivery context in the user prompt passed to Claude, derived from the session's persisted state, so Claude can make informed decisions about which actions to include in responses.

#### Scenario: DM reaction trigger
- **WHEN** session has `triggerType: "reactions"` and `dmChannel` is set
- **THEN** delivery context describes DM mode with available actions: `post_to`

#### Scenario: Thread reaction trigger
- **WHEN** session has `triggerType: "reactions"` and `dmChannel` is NOT set
- **THEN** delivery context describes Thread mode (visible in channel thread)
- **AND** mentions that `post_to` with `auto: true` and no `thread_ts` posts as a top-level channel message when the user asks for it

#### Scenario: Direct message trigger
- **WHEN** session has `triggerType: "directMessages"`
- **THEN** delivery context describes DM mode with no delivery-specific actions (response is already visible to user)
- **AND** states that `post_to` is not available (no channel context)

#### Scenario: Mention trigger
- **WHEN** session has `triggerType: "mentions"`
- **THEN** delivery context describes Mention mode (visible in channel thread)
- **AND** mentions that `post_to` with `auto: true` and no `thread_ts` posts as a top-level channel message when the user asks for it

#### Scenario: Assistant panel trigger
- **WHEN** session has `triggerType: "directMessages"` and `assistantOriginChannelId` is set
- **THEN** delivery context describes Assistant mode
- **AND** mentions that `post_to` posts to the channel the user is viewing

#### Scenario: Auto-respond trigger
- **WHEN** session has `triggerType: "autoRespond"`
- **THEN** delivery context states that `post_to` is not available

### Requirement: Delivery-Context-Aware Instructions
The system SHALL include delivery-mode-specific guidance in Claude's instructions for the `submit_response` tool.

#### Scenario: Instructions describe available actions per mode
- **WHEN** building delivery context for Claude's prompt
- **THEN** only actions relevant to the delivery mode are listed (DM reaction: `post_to`; Thread/Mention: `post_to` for channel posting; Assistant: `post_to` for channel sharing; DM/Auto-respond: no `post_to`)

#### Scenario: Instructions are descriptive not prescriptive
- **WHEN** delivery context is included in the prompt
- **THEN** it describes what actions are available, not which ones Claude must use

### Requirement: Context Recovery Guidance in DM and Mention Prompts
The system SHALL include guidance in the DM and mention delivery context sections instructing Claude to call `find_recent_interactions` when the user references something Clack may have previously said or sent.

#### Scenario: DM trigger — context recovery hint
- **WHEN** delivery context is built for a `directMessages` trigger
- **THEN** the context includes an instruction that if the user references something Clack previously said or sent, or if Clack is unsure what the user is referring to, it SHOULD call `find_recent_interactions` before responding

#### Scenario: Mention trigger — context recovery hint
- **WHEN** delivery context is built for a `mentions` trigger
- **THEN** the context includes the same context recovery instruction as DM mode

#### Scenario: Hint is scoped — not applied to all triggers
- **WHEN** delivery context is built for `reactions`, `autoRespond`, `threadReply`, or `scheduled` triggers
- **THEN** the context recovery hint is NOT included (these triggers already have thread context)

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

### Requirement: Investigation surface delivery context

When a session is an open investigation, the delivery context passed to Claude SHALL describe the investigation surface: that responses post to the main investigation thread (in the investigations channel or the requester's DM), that followed threads are read-only sources which MUST NOT be posted to, and which followed threads exist with their modes and pending counts. The lifecycle tools (`follow_thread`, `unfollow_thread`, `list_followed_threads`, `close_investigation`) SHALL be named as available actions.

#### Scenario: Channel-surface investigation context

- **WHEN** a round runs on an investigations-channel session
- **THEN** the delivery context states the main thread is the write surface and enumerates followed threads with modes

#### Scenario: DM-surface investigation context

- **WHEN** a round runs on a DM-surface investigation
- **THEN** the delivery context describes DM delivery and the followed origin thread
- **AND** states that followed threads are read-only

#### Scenario: Pending counts surfaced

- **WHEN** a `follow`-mode thread has `pendingCount > 0` at round start
- **THEN** the context includes the count and a hint that the drained messages are available to read


# clack-tool-response (delta)

## ADDED Requirements

### Requirement: Channel-Following Seed Field on Top-Level Destinations

`post_to` actions and `deliver_to` entries SHALL accept an optional `channel_attention_level` field (`"high" | "medium" | "low"`) that seeds an ephemeral channel-conversation rule when the destination is a top-level channel post. The schema SHALL NOT accept `"always"`. The field SHALL sit alongside the existing per-destination thread-engagement fields (`attention_level`, `follow_up_context`, `default_delivery_mode`), and its description SHALL contrast the two dials (destination thread vs channel window). When present, the destination's `follow_up_context` SHALL also be stored on the ephemeral rule as its responding-turn guidance.

#### Scenario: Seed on top-level post_to
- **WHEN** Claude issues a `post_to` action with a `channel`, no `thread_ts`, and `channel_attention_level: "medium"`
- **AND** the post is delivered
- **THEN** an ephemeral rule is created for that channel at `medium`

#### Scenario: Seed on top-level deliver_to entry
- **WHEN** a scheduled run's `deliver_to` entry targets a channel with no `thread_ts` and carries `channel_attention_level: "low"`
- **AND** the entry is delivered
- **THEN** an ephemeral rule is created for that channel at `low`

#### Scenario: Always rejected at schema level
- **WHEN** Claude passes `channel_attention_level: "always"`
- **THEN** schema validation fails and Claude retries with a permitted level

### Requirement: Channel Attention Reframe Field on Channel-Reply Turns

`submit_response` SHALL expose an optional `channel_attention_level` field (`"high" | "medium" | "low" | "off"`) only on turns triggered by `channelReply`. Setting it SHALL mutate (or with `"off"`, delete) the channel's ephemeral rule; omitting it SHALL leave the rule untouched. It SHALL be independent of the existing `attention_level` field, and both SHALL be settable on the same turn.

#### Scenario: Field hidden outside channel-reply turns
- **WHEN** a turn is triggered by a DM, @mention, reaction, thread reply, or scheduled run
- **THEN** the `submit_response` schema does not include `channel_attention_level`

#### Scenario: Both dials on one turn
- **WHEN** a `channelReply` turn submits with `attention_level: "high"` and `channel_attention_level: "low"`
- **THEN** the anchor session's thread dial becomes `high` and the ephemeral rule's level becomes `low`

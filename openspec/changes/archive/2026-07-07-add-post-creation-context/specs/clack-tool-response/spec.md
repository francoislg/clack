## MODIFIED Requirements

### Requirement: Channel-Following Seed Field on Top-Level Destinations

`post_to` actions and `deliver_to` entries SHALL accept an optional `channel_attention_level` field (`"high" | "medium" | "low"`) that seeds an ephemeral channel-conversation rule when the destination is a top-level channel post. The schema SHALL NOT accept `"always"`. The field SHALL sit alongside the existing per-destination thread-engagement fields (`attention_level`, `creation_context`, `default_delivery_mode`), and its description SHALL contrast the two dials (destination thread vs channel window). The destination's `creation_context` (required on every `post_to` action and `deliver_to` entry per those specs) SHALL also be stored on the ephemeral rule as its `creationContext` (surfaced to both the responding turn and the pre-analysis judge).

#### Scenario: Seed on top-level post_to
- **WHEN** Claude issues a `post_to` action with a `channel`, a `creation_context`, no `thread_ts`, and `channel_attention_level: "medium"`
- **AND** the post is delivered
- **THEN** an ephemeral rule is created for that channel at `medium` carrying the `creationContext`

#### Scenario: Seed on top-level deliver_to entry
- **WHEN** a scheduled run's `deliver_to` entry targets a channel with no `thread_ts` and carries a `creation_context` and `channel_attention_level: "low"`
- **AND** the entry is delivered
- **THEN** an ephemeral rule is created for that channel at `low` carrying the `creationContext`

#### Scenario: Always rejected at schema level
- **WHEN** Claude passes `channel_attention_level: "always"`
- **THEN** schema validation fails and Claude retries with a permitted level

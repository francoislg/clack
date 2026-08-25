## ADDED Requirements

### Requirement: Casual Posts Follow Their Channel Window On Top-Level Posts

The `casual-talk:engagement` topic SHALL instruct Claude to set `channel_attention_level: "low"` on every TOP-LEVEL `deliver_to` entry — an entry with NO `thread_ts` (a fresh opener or a top-level channel join) — in addition to the `attention_level` it already sets. This seeds an ephemeral channel-conversation window (per `ephemeral-channel-conversations`) anchored to the post, so top-level human replies in the channel about the post engage Clack for the window's lifetime and decay it on unrelated traffic.

The instruction SHALL direct Claude NOT to set `channel_attention_level` on a threaded entry (`thread_ts` present) — core ignores it there and returns a warning, so the thread dial (`attention_level`) is the only engagement lever for a threaded reply.

The seeded level SHALL be `"low"` (never `"medium"` or `"high"`): the window answers only replies that address Clack directly or are clear follow-ups about the post, so unrelated channel traffic is not answered. There SHALL be NO `CasualTalkConfig` field and no admin knob for this level — it is fixed in the engagement instructions, consistent with the plugin-provided-per-delivery attention model.

#### Scenario: Top-level opener seeds a low channel window

- **WHEN** the casual-talk run delivers a fresh top-level opener (or a top-level channel join) via `deliver_to` with no `thread_ts`
- **THEN** the entry carries `channel_attention_level: "low"` in addition to its `attention_level`
- **AND** an ephemeral channel-conversation window is seeded for the destination channel (per `ephemeral-channel-conversations`)

#### Scenario: Threaded entry does not set the channel dial

- **WHEN** the casual-talk run delivers a reply into an existing thread via `deliver_to` (`thread_ts` present)
- **THEN** the entry does NOT carry `channel_attention_level`
- **AND** engagement for that reply is governed only by `attention_level`

#### Scenario: A related top-level channel reply is answered

- **GIVEN** a casual-talk opener seeded a `"low"` channel window
- **WHEN** a human posts a top-level message in the channel that addresses Clack or is a clear follow-up about the post
- **THEN** the `channelReply` path resolves the ephemeral rule and Clack may respond (subject to the channel-continuation pre-analysis gate)

#### Scenario: Unrelated channel traffic is not answered and decays the window

- **GIVEN** a casual-talk opener seeded a `"low"` channel window
- **WHEN** a human posts an unrelated top-level message in the channel
- **THEN** Clack does not respond
- **AND** the window's level decays one rung (per `ephemeral-channel-conversations`)

#### Scenario: No config field governs the channel window

- **WHEN** the plugin loads and validates `data/plugins/casual-talk/config.json`
- **THEN** there is no `CasualTalkConfig` field for the channel-window level
- **AND** the `"low"` seed is fixed in the engagement instructions

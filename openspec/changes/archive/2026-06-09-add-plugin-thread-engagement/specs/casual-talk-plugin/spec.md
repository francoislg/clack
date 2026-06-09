## ADDED Requirements

### Requirement: Casual Posts Engage Their Thread With High Attention

The casual-talk chatter prompt SHALL instruct Claude to set `attention_level: "high"` on the `deliver_to` entry whenever it joins or opens a thread, so casual-talk threads engage human replies instead of being fire-and-forget.

When the plugin does not supply an attention level on a delivery, the default `"off"` SHALL apply (no engagement) — attention is plugin-provided per delivery, not a structural config default.

#### Scenario: Casual opener engages its thread

- **WHEN** the casual-talk run delivers a fresh opener or a thread reply via `deliver_to`
- **THEN** the entry carries `attention_level: "high"`
- **AND** the destination thread is seeded as an engaged session (per `submit-response-deliver-to` + `engaged-thread-registration`)

#### Scenario: A human reply to a casual thread is answered

- **GIVEN** a casual-talk post engaged its thread with high attention
- **WHEN** a human replies in that thread
- **THEN** the thread auto-respond path resolves the seeded session and Clack may respond (subject to the attention-rung pre-analysis gate)

## ADDED Requirements

### Requirement: post_to Thread Engagement

The `post_to` action SHALL accept the same two optional engagement fields as a `deliver_to` entry:

- `attention_level` (`"off" | "low" | "medium" | "high" | "always"`, optional, default `"off"`).
- `follow_up_context` (string, optional).

When a `post_to` action is auto-executed (or executed on click) with a non-`"off"` `attention_level`, the system SHALL — after the cross-posted message is delivered successfully — register an engaged thread session (per the `engaged-thread-registration` capability) for the action's destination, keyed to the action's `thread_ts` when present, otherwise to the posted message's timestamp. `follow_up_context`, when present, SHALL be stored as that session's follow-up context.

When `attention_level` is absent or `"off"`, `post_to` behaves exactly as today.

#### Scenario: Default post_to does not engage

- **WHEN** a `post_to` action without `attention_level` is auto-executed
- **THEN** the message is cross-posted
- **AND** no engaged thread session is seeded

#### Scenario: post_to with attention seeds the destination thread

- **WHEN** a `post_to` action with `attention_level: "high"` and `follow_up_context: "…"` is auto-executed to `(C2, top-level)` and the post lands at ts `1700000000.000300`
- **THEN** an engaged session is seeded for `(C2, "1700000000.000300")` with `attentionLevel: "high"` and the supplied follow-up context

#### Scenario: Failed cross-post seeds nothing

- **WHEN** the `post_to` delivery fails
- **THEN** no engaged thread session is seeded

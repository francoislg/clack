## MODIFIED Requirements

### Requirement: post_to Thread Engagement

The `post_to` action SHALL accept the same engagement fields as a `deliver_to` entry:

- `attention_level` (`"off" | "low" | "medium" | "high" | "always"`, optional, default `"off"`).
- `creation_context` (string, **required**) — the provenance/background this message is posted with: why it's being posted, facts to remember for later, and how to handle replies. Not shown to users. Stored as the seeded session's `creationContext` and surfaced to both the pre-analysis judge and the answer turn.

When a `post_to` action is auto-executed (or executed on click) with a non-`"off"` `attention_level`, the system SHALL — after the cross-posted message is delivered successfully — register an engaged thread session (per the `engaged-thread-registration` capability) for the action's destination, keyed to the action's `thread_ts` when present, otherwise to the posted message's timestamp. `creation_context` SHALL be stored as that session's `creationContext`.

When `attention_level` is absent or `"off"`, `post_to` behaves exactly as today (`creation_context` has no seeded session to attach to).

#### Scenario: Default post_to does not engage

- **WHEN** a `post_to` action with `creation_context` but without `attention_level` is auto-executed
- **THEN** the message is cross-posted
- **AND** no engaged thread session is seeded

#### Scenario: post_to with attention seeds the destination thread

- **WHEN** a `post_to` action with `attention_level: "high"` and `creation_context: "…"` is auto-executed to `(C2, top-level)` and the post lands at ts `1700000000.000300`
- **THEN** an engaged session is seeded for `(C2, "1700000000.000300")` with `attentionLevel: "high"` and the supplied `creationContext`

#### Scenario: Failed cross-post seeds nothing

- **WHEN** the `post_to` delivery fails
- **THEN** no engaged thread session is seeded

#### Scenario: Missing creation_context is rejected at the schema

- **WHEN** Claude stages a `post_to` action with no `creation_context`
- **THEN** schema validation fails and Claude retries with a `creation_context`

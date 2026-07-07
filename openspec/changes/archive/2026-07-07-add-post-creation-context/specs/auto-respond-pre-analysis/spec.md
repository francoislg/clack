## ADDED Requirements

### Requirement: Seeded creationContext Reaches The Judge

When the pre-analysis classifier runs for a message in a conversation that Clack itself seeded — a thread engaged via the `engaged-thread-registration` primitive, or a top-level channel post tracked by an ephemeral channel-conversation rule — the system SHALL include that conversation's `creationContext` in the classifier's context, in addition to the existing shared/thread context.

- For the thread-reply path, the `creationContext` SHALL come from the seeded session's dedicated `creationContext` field.
- For the top-level ephemeral-conversation path, the `creationContext` SHALL come from the ephemeral rule's `creationContext` field.

The `creationContext` SHALL be supplied to the classifier as additional CONTEXT, not as an instruction that overrides the verdict: the existing direct-address, thread-tone, and temporal-proximity policy SHALL continue to govern the `respond | skip | stop` decision. When no `creationContext` is present, the classifier's context SHALL be unchanged from today.

#### Scenario: Thread judge receives the seeded session's creationContext

- **GIVEN** a thread engaged with `attentionLevel: "high"` and `creationContext: "You posted a riddle; nudge, never reveal the answer."`
- **WHEN** a human reply triggers the thread-reply pre-analysis gate
- **THEN** the classifier call's context includes that `creationContext`

#### Scenario: Top-level judge receives the ephemeral rule's creationContext

- **GIVEN** an ephemeral channel-conversation rule carrying a `creationContext`
- **WHEN** a channel message triggers the ephemeral-conversation pre-analysis gate
- **THEN** the classifier call's context includes that `creationContext`

#### Scenario: Absent creationContext leaves the judge unchanged

- **GIVEN** a thread or ephemeral rule with no `creationContext`
- **WHEN** the pre-analysis classifier runs
- **THEN** its context is identical to the pre-change behavior

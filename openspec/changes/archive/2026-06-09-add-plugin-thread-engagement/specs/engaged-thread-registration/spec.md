## ADDED Requirements

### Requirement: Engaged-Thread Registration Primitive

The system SHALL expose a core helper that seeds a discoverable, engaged session for a destination `(channel, threadRoot)` so that human replies in that thread are picked up by the existing thread auto-respond path. The helper SHALL accept an `attentionLevel` (`"off" | "low" | "medium" | "high" | "always"`) and an optional `followUpContext` string.

When `attentionLevel` is `"off"` (the default), the helper SHALL register nothing and have no effect — preserving today's fire-and-forget behavior.

When `attentionLevel` is non-`"off"`, the helper SHALL create a `SessionContext` whose `channelId` equals the destination channel and whose `threadTs` equals `threadRoot`, with `attentionLevel` set to the supplied level and `additionalSystemPrompt` set to `followUpContext` (when provided). The seeded session SHALL carry no prior messages; it exists solely so `findSessionByThread(channel, threadRoot)` resolves and `isEngaged` returns true.

The seeded session's `userId` SHALL be a synthetic placeholder (it never gates a human — a human reply's turn resolves the role from the reply author).

#### Scenario: Off level registers nothing

- **WHEN** the helper is called with `attentionLevel: "off"` for `(C1, "1700000000.000100")`
- **THEN** no session is written
- **AND** `findSessionByThread("C1", "1700000000.000100")` still returns `null`

#### Scenario: Non-off level seeds a discoverable engaged session

- **WHEN** the helper is called with `attentionLevel: "high"` and `followUpContext: "…"` for `(C1, "1700000000.000100")`
- **THEN** a session is written with `channelId: "C1"`, `threadTs: "1700000000.000100"`, `attentionLevel: "high"`, and `additionalSystemPrompt: "…"`
- **AND** `findSessionByThread("C1", "1700000000.000100")` resolves to that session
- **AND** `isEngaged` returns true for it

#### Scenario: Human reply in an engaged thread is answered

- **GIVEN** a thread `(C1, T)` was seeded with `attentionLevel: "high"` and a `followUpContext`
- **WHEN** a human posts a reply under `T` in `C1`
- **THEN** the thread auto-respond path resolves the seeded session (instead of bailing for "no session")
- **AND** the answer turn includes the `followUpContext` as additional system-prompt guidance

#### Scenario: Existing session is not clobbered

- **GIVEN** a real Q&A session already owns `(C1, T)`
- **WHEN** the helper is called for `(C1, T)`
- **THEN** the existing session is left intact (no overwrite)

### Requirement: followUpContext Reaches The Answer Turn

When a human reply engages a seeded thread session, the system SHALL inject the session's `additionalSystemPrompt` (the `followUpContext`) into the answer turn's prompt, the same way an auto-respond rule's `extraContext` is injected.

#### Scenario: followUpContext shapes the reply

- **GIVEN** a seeded session with `additionalSystemPrompt: "Only answer clarifications while the question is pending."`
- **WHEN** a human reply triggers the answer turn
- **THEN** that guidance is present in the prompt for the turn

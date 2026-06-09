## MODIFIED Requirements

### Requirement: Engaged-Thread Registration Primitive

The system SHALL expose a core helper that seeds a discoverable, engaged session for a destination `(channel, threadRoot)` so that human replies in that thread are picked up by the existing thread auto-respond path. The helper SHALL accept an `attentionLevel` (`"off" | "low" | "medium" | "high" | "always"`), an optional `followUpContext` string, and an optional `deliveryMode` (`"streamer" | "invisible"`).

When `attentionLevel` is `"off"` (the default), the helper SHALL register nothing and have no effect — preserving today's fire-and-forget behavior.

When `attentionLevel` is non-`"off"`, the helper SHALL create a `SessionContext` whose `channelId` equals the destination channel and whose `threadTs` equals `threadRoot`, with `attentionLevel` set to the supplied level, `additionalSystemPrompt` set to `followUpContext` (when provided), and `deliveryMode` set to the supplied mode (when provided; absent reads as `"streamer"`). The seeded session SHALL carry no prior messages; it exists solely so `findSessionByThread(channel, threadRoot)` resolves and `isEngaged` returns true.

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

#### Scenario: deliveryMode rides onto the seeded session

- **WHEN** the helper is called with `attentionLevel: "high"` and `deliveryMode: "invisible"` for `(C1, T)`
- **THEN** the seeded session is written with `deliveryMode: "invisible"`
- **AND** a later human reply in the thread runs with the streamer suppressed

#### Scenario: Omitted deliveryMode defaults to streamer

- **WHEN** the helper is called with `attentionLevel: "high"` and no `deliveryMode`
- **THEN** the seeded session carries no explicit `deliveryMode` and its replies stream normally

#### Scenario: Human reply in an engaged thread is answered

- **GIVEN** a thread `(C1, T)` was seeded with `attentionLevel: "high"` and a `followUpContext`
- **WHEN** a human posts a reply under `T` in `C1`
- **THEN** the thread auto-respond path resolves the seeded session (instead of bailing for "no session")
- **AND** the answer turn includes the `followUpContext` as additional system-prompt guidance

#### Scenario: Existing session is not clobbered

- **GIVEN** a real Q&A session already owns `(C1, T)`
- **WHEN** the helper is called for `(C1, T)`
- **THEN** the existing session is left intact (no overwrite)

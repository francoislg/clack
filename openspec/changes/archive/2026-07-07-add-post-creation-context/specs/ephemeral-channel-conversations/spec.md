## MODIFIED Requirements

### Requirement: Ephemeral Rule Shape

The system SHALL represent a followed channel conversation as an auto-respond rule with `kind: "ephemeral"`, carrying `expiresAt` (epoch ms, sliding window end), `attentionLevel` (the live dial: `"high" | "medium" | "low"`), `sessionIds` (ordered conversation ledger, anchor first), `anchorText` (the seeding post's text, truncated to ~500 characters), and optionally `creationContext` (the destination's provenance/background, surfaced to both the pre-analysis judge and the responding turn). A rule without `kind` SHALL read as a standing rule.

The rule schema is a graceful (permissive) reader: it SHALL accept a legacy `followUpContext` field on already-persisted rules and treat it as `creationContext`, so a rule seeded just before a deploy does not lose its guidance.

#### Scenario: Ephemeral rule created by seeding
- **WHEN** a top-level post opts into channel following
- **THEN** an ephemeral rule exists for that channel with `sessionIds: [<seeding session id>]`, `anchorText` from the posted content, and `expiresAt` set to now + TTL

#### Scenario: Ledger capped
- **WHEN** appending a session ID would grow `sessionIds` beyond 10 entries
- **THEN** the oldest non-anchor entry is dropped
- **AND** the anchor entry (`sessionIds[0]`) is never dropped

#### Scenario: Legacy followUpContext is read as creationContext
- **GIVEN** a persisted ephemeral rule that carries a legacy `followUpContext` string and no `creationContext`
- **WHEN** the rule is loaded
- **THEN** its `creationContext` resolves to the legacy value

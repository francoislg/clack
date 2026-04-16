## ADDED Requirements

### Requirement: Cheat data is admin-only on read

Any MCP tool that exposes the contents of `cheats.json` — directly or in any derived shape (e.g. a per-question cheater list, a per-user cheat history, an aggregate count keyed to identifiable users) — SHALL be gated to the `admin` role or stricter.

This requirement complements the existing write-side constraint (`save_cheating` is callable by `member`, but its description forbids surfacing the call): now that cheat data is consumable by tools (see `trivia-question-search` → `get_question_history`), the read side SHALL be access-controlled so cheater identities never reach a non-admin session's MCP catalog.

The owner DM produced as a side effect of `save_cheating` is not affected by this requirement; it is a server-initiated message to the configured deployment owner, not a tool result returned to a session.

#### Scenario: Per-question cheater lookup is admin-only

- **WHEN** any tool that returns cheater identities for a given `questionId` is registered with the SDK
- **THEN** its role gate is `admin` or stricter
- **AND** sessions whose user role is below `admin` do not see the tool in their MCP catalog

#### Scenario: Member-tier search tools do not leak cheater identities

- **WHEN** `find_previous_questions` (or any future member-tier discovery tool) is invoked
- **THEN** the response contains no field naming any user as a cheater
- **AND** the response contains no aggregated cheat counter keyed to a specific user

#### Scenario: Owner DM side effect is unchanged

- **WHEN** `save_cheating` records a cheat
- **THEN** the deployment owner DM is delivered as before
- **AND** no role gate on read tooling is applied to that DM (it is a server-initiated message, not a tool result)

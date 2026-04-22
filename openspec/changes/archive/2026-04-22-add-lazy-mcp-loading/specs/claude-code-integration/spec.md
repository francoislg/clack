## MODIFIED Requirements

### Requirement: MCP Server Set Passed to the SDK

The system SHALL pass only the always-on subset of MCP servers to the Claude Agent SDK at session start. Non-always-on servers SHALL be attached dynamically via `attach_integration` during the session.

#### Scenario: Session-start MCP set is always-on only

- **GIVEN** the registry marks `clack` and `github` as `alwaysLoad: true` and 7 other servers as `alwaysLoad: false`
- **WHEN** a new SDK session is initiated from `src/claude/index.ts`
- **THEN** the `mcpServers` passed to `query()` options contains only `clack` and `github`
- **AND** none of the non-always-on servers' tool schemas are included in the session's initial context

#### Scenario: Resumed session re-attaches previously attached integrations

- **GIVEN** a prior turn of the session called `attach_integration("metabase")` successfully
- **AND** `session.attachedIntegrations` contains `"metabase"`
- **WHEN** the next turn resumes the SDK session via `resume: sdkSessionId`
- **THEN** before streaming the first user message of the resumed turn, Clack calls `query.setMcpServers(alwaysOn ∪ { metabase })`
- **AND** `metabase` is available on the first assistant turn of the resumed session

#### Scenario: Resumed session with no prior attachments

- **GIVEN** `session.attachedIntegrations` is empty (no prior `attach_integration` calls succeeded)
- **WHEN** the next turn resumes the SDK session
- **THEN** Clack calls `query.setMcpServers(alwaysOn)` (always-on set only, no integrations) before streaming the first user message
- **AND** the call is idempotent — no new tools arrive, no errors surface

#### Scenario: Resume re-attach partially fails

- **GIVEN** `session.attachedIntegrations` contains `"metabase"` and `"monday"`
- **AND** `monday`'s upstream MCP is unreachable at resume time
- **WHEN** the session resumes and calls `setMcpServers(alwaysOn ∪ { metabase, monday })`
- **THEN** the returned `errors` map contains `monday` with the connection error text
- **AND** `monday` is logged as a resume failure and dropped from `session.attachedIntegrations`
- **AND** the session continues with `metabase` still attached

#### Scenario: Attach latency visible in thinking indicator

- **WHEN** `attach_integration` calls `setMcpServers` and the attach takes noticeable time
- **THEN** the Slack thinking indicator reflects the in-progress state (e.g., `Attaching metabase…`)
- **AND** updates to the success or failure state once `setMcpServers` returns

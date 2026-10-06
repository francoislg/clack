## MODIFIED Requirements

### Requirement: Formatting-Error Attach Hint

When `submit_response` validation fails with at least one formatting-class error (per-message blocks, table, or length-budget errors from the single-message validator) AND the `response-rendering` topic is not attached to the session (neither pre-attached nor attached mid-session), the error result SHALL append a single hint line directing Claude to call `attach_integration("response-rendering")` to load the formatting rules before retrying. The hint SHALL NOT be appended when only action-class errors (unresolved intent refs, channel/routing errors) are present, nor when the topic is already attached. A topic counts as attached mid-session once `attach_integration` succeeded for it, whether or not an MCP server backs it.

#### Scenario: Formatting failure without topic hints

- **GIVEN** a scheduled session without `response-rendering` attached
- **WHEN** `submit_response` fails validation with an invalid-blocks error
- **THEN** the error result includes the attach hint alongside the collected validation errors

#### Scenario: Mixed formatting and action errors still hint

- **GIVEN** a session without `response-rendering` attached
- **WHEN** `submit_response` fails validation with both an invalid-blocks error and an unresolved action intent ref
- **THEN** the error result includes the attach hint alongside all collected errors

#### Scenario: Action-only failure never hints

- **GIVEN** a session without `response-rendering` attached
- **WHEN** `submit_response` fails validation with only an unresolved action intent ref
- **THEN** the error result contains no attach hint

#### Scenario: Attached session gets no hint

- **GIVEN** a session where `response-rendering` is attached
- **WHEN** `submit_response` fails validation with a table error
- **THEN** the error result contains the validation errors without the attach hint

#### Scenario: Topic attached mid-session gets no hint

- **GIVEN** a session that did not pre-attach `response-rendering`
- **AND** Claude called `attach_integration({ name: "response-rendering" })` successfully earlier in the session (an instructions-only topic, no MCP server)
- **WHEN** `submit_response` fails validation with a table error
- **THEN** the error result contains the validation errors without the attach hint

## MODIFIED Requirements

### Requirement: Skip Response Trigger Gating

The `skip_response` and `disengage` parameters SHALL only be available in the `submit_response` schema when the session's trigger type allows skipping. The `scheduled` trigger SHALL additionally allow `skip_response` when the underlying cron job defines a non-empty `skipConditions` field.

#### Scenario: skip_response and disengage available for autoRespond

- **WHEN** the session's trigger type is `"autoRespond"`
- **THEN** the `submit_response` tool schema includes the `skip_response` boolean parameter
- **AND** the schema includes the `disengage` boolean parameter

#### Scenario: skip_response and disengage available for threadReply

- **WHEN** the session's trigger type is `"threadReply"`
- **THEN** the `submit_response` tool schema includes the `skip_response` boolean parameter
- **AND** the schema includes the `disengage` boolean parameter

#### Scenario: skip_response available for scheduled runs with skipConditions

- **WHEN** the session's trigger type is `"scheduled"`
- **AND** the originating cron job has a non-empty `skipConditions` string
- **THEN** the `submit_response` tool schema includes the `skip_response` boolean parameter
- **AND** the schema does NOT include the `disengage` boolean parameter (disengage is only meaningful for tracked-conversation triggers)

#### Scenario: Skip still enforces requiredTools gate

- **WHEN** a scheduled session has both `skipConditions` and non-empty `requiredTools`
- **AND** Claude calls `submit_response` with `skip_response: true` before calling every required tool
- **THEN** `submit_response` SHALL return the existing `requiredTools` gate error (missing tools listed) and NOT accept the skip
- **AND** Claude is expected to call the missing tool(s) and then retry with `skip_response: true`
- **AND** this matches today's behavior: the `requiredTools` gate runs before the skip branch, so a skip cannot bypass obligations the operator declared for the run

#### Scenario: skip_response not available for scheduled runs without skipConditions

- **WHEN** the session's trigger type is `"scheduled"`
- **AND** the originating cron job has no `skipConditions` (unset or empty string)
- **THEN** the `submit_response` tool schema does NOT include the `skip_response` parameter
- **AND** does NOT include the `disengage` parameter

#### Scenario: skip_response not available for explicit triggers

- **WHEN** the session's trigger type is `"reactions"`, `"directMessages"`, `"mentions"`, or any other explicit trigger
- **THEN** the `submit_response` tool schema does NOT include the `skip_response` parameter
- **AND** does NOT include the `disengage` parameter

### Requirement: Skip Response Prompt Guidance

The system SHALL include prompt guidance telling Claude when it can skip a response. For auto-respond and thread-reply triggers the guidance applies whenever the conversation does not warrant a reply. For scheduled triggers the guidance is rendered only when the job defines `skipConditions`, and it instructs Claude to evaluate those conditions before doing anything else.

#### Scenario: Auto-respond prompt includes skip guidance

- **WHEN** the delivery context prompt is built for a session with triggerType `"autoRespond"` or `"threadReply"`
- **THEN** the prompt includes guidance that Claude can use `skip_response` when users are talking to each other and not following up on what Clack said
- **AND** the prompt does NOT include the exact safeguard acknowledgment string

#### Scenario: Scheduled prompt includes skipConditions pre-check

- **WHEN** the delivery context prompt is built for a session with triggerType `"scheduled"`
- **AND** the originating cron job defines a non-empty `skipConditions` string
- **THEN** the prompt includes a pre-check section instructing Claude to evaluate the provided conditions before any other work
- **AND** the prompt includes the verbatim `skipConditions` text supplied by the operator
- **AND** the prompt tells Claude to call `submit_response` with `skip_response: true` when any condition applies
- **AND** the prompt does NOT include the exact safeguard acknowledgment string

#### Scenario: Scheduled prompt omits skip guidance when skipConditions is absent

- **WHEN** the delivery context prompt is built for a session with triggerType `"scheduled"`
- **AND** the originating cron job has no `skipConditions` (unset or empty)
- **THEN** the prompt does NOT include any skip-related guidance

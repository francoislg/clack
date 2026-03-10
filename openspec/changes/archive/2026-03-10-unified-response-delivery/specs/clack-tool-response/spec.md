## MODIFIED Requirements

### Requirement: submit_response Tool

The system SHALL provide a `submit_response` MCP tool that defines the user-facing response with structured content and actions, and delivers it to Slack.

#### Scenario: Basic response with sections

- **WHEN** Claude calls `submit_response` with a sections array
- **THEN** each section contains an optional `title` (string) and a required `body` (string, markdown)
- **AND** the tool validates the rendered blocks
- **AND** the tool delivers the response to Slack via the injected deliver callback
- **AND** captures the payload for session persistence
- **AND** returns a delivery confirmation to Claude

#### Scenario: Response with actions

- **WHEN** Claude calls `submit_response` with an actions array
- **THEN** each action has a `type` from the known set: `followup`, `choice`, `change`, `config_update`, `update`, `send_to_thread`
- **AND** each action type has its own schema for additional fields
- **AND** ref-based actions (`change`, `config_update`, `update`) support an optional `auto` boolean field

#### Scenario: Delivery failure returned to Claude

- **WHEN** Claude calls `submit_response` with valid sections and actions
- **AND** the Slack delivery fails (msg_too_long, invalid_blocks, or other API error)
- **THEN** the tool returns an error to Claude with the Slack error details
- **AND** does NOT capture the payload
- **AND** Claude can adjust the content and call `submit_response` again

#### Scenario: Successful delivery

- **WHEN** Claude calls `submit_response` and Slack delivery succeeds
- **THEN** the tool returns `{ success: true, delivered: true }` to Claude
- **AND** captures the payload in ResponseCapture for session persistence

#### Scenario: Already delivered guard

- **WHEN** Claude calls `submit_response` after a previous successful delivery in the same session
- **THEN** the tool returns an error indicating the response was already delivered
- **AND** does NOT attempt a second delivery

#### Scenario: Fallback when submit_response not called

- **WHEN** the query completes without Claude calling `submit_response`
- **THEN** the system falls back to Claude's raw text output
- **AND** delivers it via the streamer or one-shot posting

### Requirement: Block Validation Before Delivery

The `submit_response` tool SHALL validate the rendered Slack blocks against known Block Kit constraints before attempting delivery.

#### Scenario: Section text within limits

- **WHEN** Claude calls `submit_response` with sections whose rendered mrkdwn text is within Slack's 3000-character section limit
- **THEN** validation passes and delivery is attempted

#### Scenario: Section text exceeds limit

- **WHEN** Claude calls `submit_response` with a section whose rendered mrkdwn text exceeds 3000 characters (after markdown-to-mrkdwn conversion and splitting)
- **THEN** the tool returns an error identifying the oversized section (by index and title if present)
- **AND** includes the current character count and the limit
- **AND** does NOT attempt delivery
- **AND** Claude can fix the section and retry `submit_response`

#### Scenario: Button label exceeds limit

- **WHEN** Claude calls `submit_response` with an action whose rendered button label exceeds 75 characters
- **THEN** the tool returns an error identifying the action (by index and type)
- **AND** includes the current character count and the limit

#### Scenario: Total block count exceeds limit

- **WHEN** the rendered blocks (sections + divider + action rows) exceed 50 total blocks
- **THEN** the tool returns an error indicating the block count and the 50-block limit
- **AND** suggests reducing the number of sections

#### Scenario: Multiple validation errors

- **WHEN** multiple block constraints are violated
- **THEN** the tool returns all errors in a single response
- **AND** Claude can address all issues before retrying

## REMOVED Requirements

### Requirement: Block Validation Before Capture

**Reason**: Replaced by "Block Validation Before Delivery" which validates before attempting real Slack delivery instead of capture-only.
**Migration**: No action needed — the validation logic is identical, only the name and subsequent action (deliver vs. capture) changed.

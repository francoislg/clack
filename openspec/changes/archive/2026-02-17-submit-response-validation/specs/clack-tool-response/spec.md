## ADDED Requirements

### Requirement: Block Validation Before Capture

The `submit_response` tool SHALL validate the rendered Slack blocks against known Block Kit constraints before capturing the payload.

#### Scenario: Section text within limits

- **WHEN** Claude calls `submit_response` with sections whose rendered mrkdwn text is within Slack's 3000-character section limit
- **THEN** the payload is captured and success is returned

#### Scenario: Section text exceeds limit

- **WHEN** Claude calls `submit_response` with a section whose rendered mrkdwn text exceeds 3000 characters (after markdown-to-mrkdwn conversion and splitting)
- **THEN** the tool returns an error identifying the oversized section (by index and title if present)
- **AND** includes the current character count and the limit
- **AND** does NOT capture the payload
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

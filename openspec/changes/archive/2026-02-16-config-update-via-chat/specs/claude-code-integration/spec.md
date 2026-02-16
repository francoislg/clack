## MODIFIED Requirements

### Requirement: Structured Response Parsing

The system SHALL parse structured XML tags from Claude's response to route to specialized handlers.

#### Scenario: Parse change request
- **WHEN** Claude's response contains `<change-request>` tags
- **THEN** the system extracts branch, description, and repo
- **AND** routes to the change workflow

#### Scenario: Parse resume request
- **WHEN** Claude's response contains `<resume-request>` tags
- **THEN** the system extracts branch name and repo
- **AND** routes to the resume workflow

#### Scenario: Parse config update
- **WHEN** Claude's response contains `<config-update>` tags
- **THEN** the system extracts file and content
- **AND** routes to the config update confirmation flow

#### Scenario: Parsing priority order
- **WHEN** Claude's response contains multiple tag types
- **THEN** the system checks in order: change-request, resume-request, config-update
- **AND** the first match wins

#### Scenario: No structured tags found
- **WHEN** Claude's response contains no recognized XML tags
- **THEN** the system treats the response as a regular answer

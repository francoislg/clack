## MODIFIED Requirements

### Requirement: Status Section

The system SHALL display bot status information to all users.

#### Scenario: Show repository status filtered by role
- **WHEN** building the status section
- **THEN** list only repositories the current user has read access to
- **AND** show their names and descriptions

#### Scenario: Show access tags for dev+ users
- **GIVEN** the current user has the dev role or higher
- **WHEN** displaying a repository in the status section
- **THEN** show access level tags below each repo (e.g., `read: all · write: dev+`)
- **AND** for read-only repos (no write access defined), show `read-only`

#### Scenario: Hide access tags for members
- **GIVEN** the current user has the member role
- **WHEN** displaying repositories in the status section
- **THEN** show only repo names and descriptions without access tags

#### Scenario: Show MCP server status
- **GIVEN** MCP servers are configured
- **WHEN** building the status section
- **THEN** list connected MCP servers
- **AND** indicate connection status for each

#### Scenario: No MCP servers configured
- **GIVEN** no MCP servers are configured
- **WHEN** building the status section
- **THEN** show "No MCP servers configured" or omit the section

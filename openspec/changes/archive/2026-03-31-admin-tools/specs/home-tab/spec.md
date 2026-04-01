# home-tab Delta Specification (admin-tools change)

## ADDED Requirements

### Requirement: Admin Config Tools Status

The system SHALL indicate in the Home Tab status section that admin configuration editing is available via conversation.

#### Scenario: Show admin config tools hint for admin users
- **WHEN** building the Home Tab for a user with admin or owner role
- **THEN** display a context block in the Configuration section noting that core config files (config.json, mcp.json, .env, tool mappings) can be edited by asking in a conversation

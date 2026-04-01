# admin-config-tools Delta Specification (secure-env-tools change)

## MODIFIED Requirements

### Requirement: File Path Allowlist

The system SHALL restrict admin file tools to a static allowlist of paths relative to `data/`.

#### Scenario: Allowed file paths
- **WHEN** an admin tool receives a file path
- **THEN** the system accepts: `config.json`, `mcp.json`, and any path matching `configuration/tool_mapping/*.json`
- **AND** does NOT accept `auth/.env` (environment variables are managed via dedicated env tools)

#### Scenario: Reject disallowed path
- **WHEN** an admin tool receives a path not in the allowlist (e.g., `auth/slack.json`, `auth/github-app.pem`, `state/roles.json`, `auth/.env`)
- **THEN** the tool returns an error listing the allowed paths

#### Scenario: Reject path traversal
- **WHEN** an admin tool receives a path containing `..` segments
- **THEN** the tool returns an error indicating path traversal is not allowed

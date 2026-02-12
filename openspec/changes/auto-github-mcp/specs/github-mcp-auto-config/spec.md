## ADDED Requirements

### Requirement: Auto-detect GitHub App Credentials for MCP

The system SHALL automatically configure a GitHub MCP server when GitHub App credentials are present.

#### Scenario: GitHub credentials exist and no manual MCP override
- **WHEN** `data/auth/github.json` exists and is valid
- **AND** `mcp.json` does not contain a `github` key
- **THEN** the system injects a GitHub MCP server entry into the MCP servers passed to Claude
- **AND** the entry uses the `github-mcp-server` binary with `stdio` transport
- **AND** the entry includes a fresh installation token as `GITHUB_PERSONAL_ACCESS_TOKEN`

#### Scenario: GitHub credentials missing
- **WHEN** `data/auth/github.json` does not exist
- **THEN** the system does not inject a GitHub MCP server
- **AND** MCP loading proceeds with only the servers defined in `mcp.json`

#### Scenario: Manual github MCP entry takes precedence
- **WHEN** `mcp.json` contains a key named `github`
- **THEN** the system uses the manually configured entry
- **AND** does not inject an auto-configured GitHub MCP server

### Requirement: Permission-to-Toolset Mapping

The system SHALL derive `GITHUB_TOOLSETS` from the installation token's permissions.

#### Scenario: Map token permissions to toolsets
- **WHEN** an installation token is generated
- **THEN** the system reads the `permissions` object from the token response
- **AND** maps each permission key to a `GITHUB_TOOLSETS` value:
  - `pull_requests` → `pull_requests`
  - `issues` → `issues`
  - `contents` → `repos`
  - `actions` → `actions`
  - `security_events` → `code_security`
- **AND** sets the `GITHUB_TOOLSETS` environment variable to the comma-separated list of matched toolsets

#### Scenario: Permission key not in mapping
- **WHEN** the token has a permission key not listed in the mapping (e.g., `metadata`)
- **THEN** that permission is ignored for toolset derivation
- **AND** no error is raised

#### Scenario: No mappable permissions
- **WHEN** the token has no permissions that map to known toolsets
- **THEN** the system does not inject the GitHub MCP server
- **AND** logs a warning explaining no toolsets could be derived

### Requirement: Token Freshness Per Query

The system SHALL provide a fresh (or cached) token for each Claude query session.

#### Scenario: Token injected per query call
- **WHEN** MCP servers are loaded for a Claude query
- **THEN** the GitHub MCP entry is rebuilt with the current installation token
- **AND** the token is obtained from `getInstallationToken()` which returns cached tokens when valid

#### Scenario: Static MCP config cached separately
- **WHEN** `mcp.json` is loaded
- **THEN** its contents are cached after the first read
- **AND** only the GitHub MCP entry is rebuilt on subsequent calls

### Requirement: Graceful Degradation When Binary Missing

The system SHALL gracefully handle the absence of the `github-mcp-server` binary.

#### Scenario: Binary not found on PATH
- **WHEN** `github-mcp-server` is not installed or not on PATH
- **THEN** the system logs a warning that GitHub MCP auto-configuration is skipped
- **AND** startup continues without GitHub MCP
- **AND** no error is thrown

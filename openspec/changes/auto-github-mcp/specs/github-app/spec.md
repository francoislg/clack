## MODIFIED Requirements

### Requirement: Installation Token Generation

The system SHALL generate short-lived GitHub installation tokens from the App credentials.

#### Scenario: Generate installation token on demand
- **WHEN** a GitHub API call or git operation is needed
- **THEN** the system generates an installation token using the App ID, installation ID, and private key
- **AND** the token is valid for GitHub API and HTTPS git operations
- **AND** the token response includes the `permissions` object

#### Scenario: Token caching
- **WHEN** an installation token is generated
- **THEN** the system caches the token, permissions, and expiry in memory
- **AND** reuses the cached result for subsequent requests until it approaches expiry

#### Scenario: Token refresh before expiry
- **WHEN** the cached token is within 5 minutes of expiry
- **THEN** the system generates a new token before the next operation
- **AND** replaces the cached token and permissions

#### Scenario: Token generation failure
- **WHEN** token generation fails (invalid credentials, network error)
- **THEN** the system logs the error with details
- **AND** the operation that requested the token fails with a descriptive error

#### Scenario: Permissions accessible from token result
- **WHEN** `getInstallationToken()` is called
- **THEN** it returns an object with `token`, `permissions`, and `expiresAt`
- **AND** `permissions` is a `Record<string, string>` mapping permission names to access levels (e.g., `{ pull_requests: "read", contents: "write" }`)

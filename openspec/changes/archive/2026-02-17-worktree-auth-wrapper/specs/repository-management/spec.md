## MODIFIED Requirements

### Requirement: GitHub App Authentication
The system SHALL use GitHub App installation tokens for all git operations.

#### Scenario: Token-based HTTPS authentication
- **WHEN** a git operation requires authentication
- **THEN** the system generates an installation token via the GitHub App
- **AND** constructs an HTTPS URL with the token: `https://x-access-token:{token}@github.com/owner/repo.git`
- **AND** refreshes the token before each network operation

#### Scenario: Token caching
- **WHEN** an installation token is generated
- **THEN** the system caches it in memory
- **AND** reuses the cached token until 5 minutes before expiry
- **AND** generates a new token when the cache expires

#### Scenario: Structural token refresh for Claude-mediated operations
- **WHEN** a Claude invocation targets a worktree
- **THEN** token refresh is enforced by the worktree-aware invocation wrapper
- **AND** individual workflow functions (review, update, execution) SHALL NOT manage token refresh themselves
- **AND** only non-Claude git operations (direct `simple-git` calls) manage their own token refresh

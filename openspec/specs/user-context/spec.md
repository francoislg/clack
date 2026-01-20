# user-context Specification

## Purpose
TBD - created by archiving change add-user-context. Update Purpose after archive.
## Requirements
### Requirement: User Name Configuration
The system SHALL provide a configuration option to enable or disable username fetching.

#### Scenario: Disabled by default
- **WHEN** the configuration does not specify `fetchUserNames`
- **THEN** the system defaults to `false`
- **AND** no user info API calls are made
- **AND** thread context shows `[User]` labels

#### Scenario: Enabled via config
- **WHEN** `fetchUserNames` is set to `true` in configuration
- **THEN** the system resolves user IDs to names
- **AND** stores username and display name in session data

### Requirement: User Info Caching
The system SHALL cache resolved user information in memory.

#### Scenario: Cache miss
- **WHEN** a user ID is not in the cache
- **AND** `fetchUserNames` is enabled
- **THEN** the system calls the Slack `users.info` API
- **AND** stores the result in the cache
- **AND** returns the user info

#### Scenario: Cache hit
- **WHEN** a user ID is already in the cache
- **THEN** the system returns the cached value
- **AND** does not make an API call

#### Scenario: API error handling
- **WHEN** the `users.info` API call fails
- **THEN** the system logs the error
- **AND** returns undefined for that user
- **AND** does not cache the failure

### Requirement: Thread Context User Names
The system SHALL include user names in thread context when enabled.

#### Scenario: Thread messages with names
- **WHEN** `fetchUserNames` is enabled
- **AND** thread context is fetched
- **THEN** each message includes `username` and `displayName` if resolvable
- **AND** unresolvable users have undefined name fields

#### Scenario: Thread messages without names
- **WHEN** `fetchUserNames` is disabled
- **THEN** messages do not include username or displayName fields

### Requirement: Claude Prompt Formatting
The system SHALL format user names in the Claude prompt with fallback logic.

#### Scenario: Display name available
- **WHEN** a message has a `displayName`
- **THEN** the prompt shows `[DisplayName]: message`

#### Scenario: Username only
- **WHEN** a message has `username` but no `displayName`
- **THEN** the prompt shows `[username]: message`

#### Scenario: No name available
- **WHEN** a message has neither `username` nor `displayName`
- **THEN** the prompt shows `[User]: message`

#### Scenario: Bot messages
- **WHEN** a message is from a bot
- **THEN** the prompt shows `[Clack Bot]: message` regardless of name settings


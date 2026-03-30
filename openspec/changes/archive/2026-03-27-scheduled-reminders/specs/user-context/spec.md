## MODIFIED Requirements

### Requirement: User Info Caching

The system SHALL cache resolved user information in memory, including timezone data.

#### Scenario: Cache miss

- **WHEN** a user ID is not in the cache
- **AND** `fetchUserNames` is enabled
- **THEN** the system calls the Slack `users.info` API
- **AND** stores the result in the cache including the `tz` (IANA timezone) field
- **AND** returns the user info

#### Scenario: Cache hit

- **WHEN** a user ID is already in the cache
- **THEN** the system returns the cached value (including `tz`)
- **AND** does not make an API call

#### Scenario: API error handling

- **WHEN** the `users.info` API call fails
- **THEN** the system logs the error
- **AND** returns undefined for that user
- **AND** does not cache the failure

#### Scenario: Timezone field populated

- **WHEN** a user is resolved via `users.info`
- **THEN** the `UserInfo` record includes the `tz` field from `result.user.tz` (e.g., `America/New_York`)
- **AND** if the user has no timezone set in Slack, `tz` is `undefined`

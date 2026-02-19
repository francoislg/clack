## ADDED Requirements

### Requirement: Migration Error DM Reporting

The system SHALL send migration error details to the admin via DM when a migration fails.

#### Scenario: DM admin on migration failure
- **WHEN** a migration fails during execution
- **AND** the admin has an open DM channel with the bot
- **THEN** send a DM to the admin with the migration name, error details, and guidance for resolution

#### Scenario: DM failure during migration error reporting
- **WHEN** sending the migration error DM fails
- **THEN** log the failure
- **AND** rely on the home tab banner as the fallback notification mechanism

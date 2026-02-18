## ADDED Requirements

### Requirement: Migration Status Banner

The system SHALL display a migration status banner on the Home tab when migrations are pending or failed.

#### Scenario: Show error banner on failed migration
- **WHEN** a migration has failed (e.g., admin DM timeout, Claude execution error)
- **AND** any user opens the Home tab
- **THEN** display a warning banner at the top of the Home tab describing the migration failure
- **AND** include the migration name and error summary

#### Scenario: Show error banner to admin with action guidance
- **WHEN** a migration has failed
- **AND** an admin or owner opens the Home tab
- **THEN** display the warning banner with guidance on how to resolve the issue
- **AND** suggest contacting the Clack operator or checking logs

#### Scenario: No banner when migrations are healthy
- **WHEN** no migrations are pending or failed
- **AND** a user opens the Home tab
- **THEN** do not display any migration-related banner

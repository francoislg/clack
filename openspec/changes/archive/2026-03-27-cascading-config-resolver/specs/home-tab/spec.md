## MODIFIED Requirements

### Requirement: Configuration Section Display

The system SHALL display a summary Configuration section on the Home tab for users with config edit permissions, showing one line per role directory.

#### Scenario: Show role directories with file counts
- **GIVEN** the user has config edit permissions (admin or owner)
- **WHEN** building the Configuration section
- **THEN** display one line per role directory (`user/`, `dev/`, `admin/`, `owner/`)
- **AND** each line shows the count of default files and custom files (e.g., `user/ — 5 default, 2 custom`)
- **AND** directories with no files in either tier are omitted

#### Scenario: Show repo instruction files
- **GIVEN** repositories are configured
- **WHEN** building the Configuration section
- **THEN** display one line per repository showing its instruction files and their status
- **AND** repo lines appear after role directory lines

#### Scenario: Show chat hint
- **GIVEN** the user views the Configuration section
- **WHEN** the directory summary has been rendered
- **THEN** display a context hint directing the user to chat with Clack to view or update configuration files

#### Scenario: Hide from non-editors
- **GIVEN** the user does not have config edit permissions
- **WHEN** building the home view
- **THEN** do not include the Configuration section

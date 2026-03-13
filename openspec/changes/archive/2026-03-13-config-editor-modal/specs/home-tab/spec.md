## MODIFIED Requirements

### Requirement: Configuration Section Display

The system SHALL display an interactive Configuration section on the Home tab for users with config edit permissions, showing directories with [View] buttons.

#### Scenario: Show role directories with file counts and View button
- **GIVEN** the user has config edit permissions (admin or owner)
- **WHEN** building the Configuration section
- **THEN** display one line per role directory (`user/`, `dev/`, `admin/`) that has files
- **AND** each line shows the total file count (e.g., `user/ (6 files)`)
- **AND** each line includes a [View] button

#### Scenario: Show repo directories with file counts and View button
- **GIVEN** repositories are configured
- **WHEN** building the Configuration section
- **THEN** display one line per repository directory (e.g., `applauz-monorepo/ (2 files)`)
- **AND** each line includes a [View] button
- **AND** repo lines appear after role directory lines

#### Scenario: Show chat hint
- **GIVEN** the user views the Configuration section
- **WHEN** the directory listing has been rendered
- **THEN** display a context hint directing the user to chat with Clack for advanced configuration

#### Scenario: Hide from non-editors
- **GIVEN** the user does not have config edit permissions
- **WHEN** building the home view
- **THEN** do not include the Configuration section

## REMOVED Requirements

### Requirement: No Configuration Edit Modal

**Reason**: Replaced by the new modal-based configuration editor in `admin-edit-instructions`.
**Migration**: The Configuration section now includes [View] buttons that open interactive modals for browsing and editing files.

### Requirement: No edit buttons displayed

**Reason**: The Configuration section now includes interactive [View] buttons per directory.
**Migration**: See updated `Configuration Section Display` requirement.

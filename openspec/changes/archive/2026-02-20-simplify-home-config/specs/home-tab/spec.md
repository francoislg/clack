## ADDED Requirements

### Requirement: Configuration Section Display

The system SHALL display a read-only Configuration section on the Home tab for users with config edit permissions.

#### Scenario: Show instruction files with status
- **GIVEN** the user has config edit permissions (admin or owner)
- **WHEN** building the Configuration section
- **THEN** list each instruction file with its filename and status indicator
- **AND** the status SHALL be one of: "Customized" (override exists), "Default" (using default), or "Not created" (no file)

#### Scenario: No edit buttons displayed
- **GIVEN** the user views the Configuration section
- **WHEN** the section renders
- **THEN** no "Edit", "Customize", or "Create" buttons SHALL be displayed on the file entries

#### Scenario: Show chat hint
- **GIVEN** the user views the Configuration section
- **WHEN** the file list has been rendered
- **THEN** display a context hint directing the user to chat with Clack to update configuration files

#### Scenario: Hide from non-editors
- **GIVEN** the user does not have config edit permissions
- **WHEN** building the home view
- **THEN** do not include the Configuration section

### Requirement: No Configuration Edit Modal

The system SHALL NOT provide a modal-based configuration file editor from the Home tab.

#### Scenario: No edit_config_file action registered
- **WHEN** the Slack app initializes
- **THEN** no action handler SHALL be registered for `edit_config_file`

#### Scenario: No edit_config_file_modal callback registered
- **WHEN** the Slack app initializes
- **THEN** no view submission handler SHALL be registered for `edit_config_file_modal`

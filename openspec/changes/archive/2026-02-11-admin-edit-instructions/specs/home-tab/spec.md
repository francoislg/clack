## MODIFIED Requirements

### Requirement: Home Tab Event Handling

The system SHALL respond to Slack Home tab open events.

#### Scenario: Register home tab handler
- **WHEN** the Slack app initializes
- **THEN** register a handler for `app_home_opened` events

#### Scenario: Update home view on open
- **GIVEN** a user opens the bot's Home tab
- **WHEN** the `app_home_opened` event fires
- **THEN** the system builds a view based on user's role
- **AND** publishes the view via `views.publish`

## ADDED Requirements

### Requirement: Configuration Section

The system SHALL display a configuration section to admins on the Home Tab showing all instruction files with their override status.

#### Scenario: Show configuration section for admins
- **GIVEN** the user is an admin (owner or admin role)
- **WHEN** building the home view
- **THEN** display a "Configuration" section after Role Management
- **AND** list all convention-based instruction files

#### Scenario: Show file with override (Customized)
- **GIVEN** an instruction file has an override in `data/configuration/`
- **WHEN** displaying the file in the configuration section
- **THEN** show the filename with a "Customized" label
- **AND** show an "Edit" button

#### Scenario: Show file with default only (Default)
- **GIVEN** an instruction file exists only in `data/default_configuration/`
- **WHEN** displaying the file in the configuration section
- **THEN** show the filename with a "Default" label
- **AND** show a "Customize" button

#### Scenario: Hide configuration section from non-admins
- **GIVEN** the user is not an admin
- **WHEN** building the home view
- **THEN** do not include the configuration section

## ADDED Requirements

### Requirement: Instruction File Listing

The system SHALL list all known instruction files with their override status.

#### Scenario: List instruction files with status
- **WHEN** the system lists instruction files for the configuration UI
- **THEN** it returns all convention-based instruction filenames (`instructions.md`, `dev_instructions.md`, `admin_instructions.md`, `user_instructions.md`)
- **AND** for each file, indicates whether an override exists in `data/configuration/`
- **AND** for each file, indicates whether a default exists in `data/default_configuration/`

#### Scenario: Read file content for editing
- **GIVEN** an instruction file is requested for editing
- **WHEN** an override exists in `data/configuration/`
- **THEN** the system returns the override content

#### Scenario: Read default content for customization
- **GIVEN** an instruction file is requested for editing
- **AND** no override exists in `data/configuration/`
- **WHEN** a default exists in `data/default_configuration/`
- **THEN** the system returns the default content as a starting point

### Requirement: Edit Instructions via Slack Modal

The system SHALL allow admins to edit instruction files through a Slack modal.

#### Scenario: Edit existing override
- **GIVEN** the user is an admin (owner or admin role)
- **AND** an override exists in `data/configuration/` for the file
- **WHEN** the user clicks "Edit"
- **THEN** a Slack modal opens with the override content pre-filled in a multiline text input

#### Scenario: Customize from default
- **GIVEN** the user is an admin
- **AND** no override exists (only the default in `data/default_configuration/`)
- **WHEN** the user clicks "Customize"
- **THEN** a Slack modal opens with the default content pre-filled
- **AND** on submit, the content is written to `data/configuration/` as a new override

#### Scenario: Save edited content
- **GIVEN** the edit modal is open with modified content
- **WHEN** the admin submits the modal
- **THEN** the system writes the new content to `data/configuration/{filename}`
- **AND** the Home Tab refreshes to reflect the update

#### Scenario: File too large for Slack modal
- **GIVEN** an instruction file exceeds 3000 characters
- **WHEN** the admin clicks "Edit" or "Customize"
- **THEN** the modal shows a message explaining the file is too large to edit via Slack
- **AND** suggests editing via server access instead

#### Scenario: Admin role enforcement on submission
- **WHEN** a modal submission is received for a file edit
- **THEN** the system verifies the submitting user is an admin
- **AND** rejects the submission if they are not

### Requirement: Path Safety

The system SHALL prevent writes outside `data/configuration/`.

#### Scenario: Valid file path
- **GIVEN** a file edit targets a path inside `data/configuration/`
- **WHEN** the write is attempted
- **THEN** the system resolves the full path and confirms it starts with the configuration directory
- **AND** allows the write

#### Scenario: Path traversal attempt
- **GIVEN** a file edit targets a path with traversal (e.g., `../auth/slack.json`)
- **WHEN** the write is attempted
- **THEN** the system rejects the write
- **AND** logs the attempt

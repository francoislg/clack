## MODIFIED Requirements

### Requirement: Instruction File Listing

The system SHALL list all instruction files grouped by directory, with source status and editability.

#### Scenario: List role directory files in picker modal
- **WHEN** an admin clicks [View] on a role directory (e.g., `user/`)
- **THEN** open a modal titled `{role}/ Instructions`
- **AND** list all `.md` files in that directory alphabetically
- **AND** each file entry shows its source status: no label for default, "Customized" for overridden, "Custom" for custom-only
- **AND** each editable file has an [Edit] button
- **AND** files whose effective content exceeds 3000 characters show "Too large — use chat" instead of an [Edit] button

#### Scenario: List repo directory files in picker modal
- **WHEN** an admin clicks [View] on a repo directory (e.g., `applauz-monorepo/`)
- **THEN** open a modal titled `{repo}/ Instructions`
- **AND** list the convention-based files (`changes_instructions.md`, `worktree_setup_instructions.md`)
- **AND** each file entry shows its status and an [Edit] button (or "Too large" label)
- **AND** no [+ Create New File] button is shown

#### Scenario: Create new file button for role directories
- **WHEN** a file picker modal is open for a role directory
- **THEN** display a [+ Create New File] button below the file list

### Requirement: Modal Title Length

The edit modal title SHALL respect Slack's 24-character limit for modal titles.

#### Scenario: Filename fits within title limit
- **GIVEN** a `{dir}/{filename}` path is 24 characters or fewer
- **WHEN** the edit modal is opened
- **THEN** the full `{dir}/{filename}` is used as the modal title

#### Scenario: Filename exceeds title limit
- **GIVEN** a `{dir}/{filename}` path exceeds 24 characters
- **WHEN** the edit modal is opened
- **THEN** the title is truncated to 23 characters with a trailing `…` character

### Requirement: Edit Instructions via Slack Modal

The system SHALL allow admins to edit instruction files through a stacked Slack modal.

#### Scenario: Edit default file (create override)
- **GIVEN** the user is an admin or owner
- **AND** the file exists only as a default (no custom override)
- **WHEN** the user clicks [Edit] on the file
- **THEN** a modal is pushed onto the stack with the default content pre-filled in a textarea
- **AND** the modal submit button is labeled "Create Override"
- **AND** the status shows "Default — no custom override"

#### Scenario: Edit existing override
- **GIVEN** the user is an admin or owner
- **AND** a custom override exists for the file
- **WHEN** the user clicks [Edit] on the file
- **THEN** a modal is pushed with the override content pre-filled in a textarea
- **AND** the modal submit button is labeled "Save"

#### Scenario: Edit custom-only file
- **GIVEN** the user is an admin or owner
- **AND** the file is custom-only (no shipped default)
- **WHEN** the user clicks [Edit] on the file
- **THEN** a modal is pushed with the file content pre-filled in a textarea
- **AND** the modal submit button is labeled "Save"

#### Scenario: Save edited content
- **GIVEN** the editor modal is open with modified content
- **WHEN** the admin submits the modal
- **THEN** the system writes the content via `writeInstructionFile()`
- **AND** refreshes the Home Tab to reflect the update

#### Scenario: Admin role enforcement on submission
- **WHEN** a modal submission is received for a file edit
- **THEN** the system verifies the submitting user has config edit permissions
- **AND** rejects the submission if they do not

### Requirement: Create New Instruction File

The system SHALL allow admins to create new instruction files in role directories.

#### Scenario: Open create new file modal
- **WHEN** an admin clicks [+ Create New File] in a role directory picker
- **THEN** a modal is pushed with a filename text input and a content textarea
- **AND** the modal submit button is labeled "Create"
- **AND** a hint indicates `.md` extension is added automatically

#### Scenario: Submit new file
- **WHEN** the admin submits the create modal with a filename and content
- **THEN** the system appends `.md` to the filename if not already present
- **AND** writes the file via `writeInstructionFile()` to the role directory
- **AND** refreshes the Home Tab

#### Scenario: Reject duplicate filename
- **GIVEN** a file with the same name already exists in the directory
- **WHEN** the admin submits the create modal
- **THEN** the system returns a validation error on the filename field

### Requirement: Delete Instruction File Override

The system SHALL allow admins to delete custom overrides or custom-only files.

#### Scenario: Reset to default (delete override)
- **GIVEN** the editor modal is open for a file that has both a default and a custom override
- **WHEN** the admin clicks "Reset to Default"
- **THEN** the system deletes the override file from `data/configuration/`
- **AND** updates the modal in-place to show the default content
- **AND** changes the status to "Default — no custom override"
- **AND** changes the submit button to "Create Override"

#### Scenario: Delete custom-only file
- **GIVEN** the editor modal is open for a custom-only file (no shipped default)
- **WHEN** the admin clicks "Delete File"
- **THEN** the system deletes the file from `data/configuration/`
- **AND** closes the stacked modal (returns to file picker)

#### Scenario: No delete button for default-only files
- **GIVEN** the editor modal is open for a file with no custom override
- **WHEN** the modal renders
- **THEN** no delete or reset button is shown

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

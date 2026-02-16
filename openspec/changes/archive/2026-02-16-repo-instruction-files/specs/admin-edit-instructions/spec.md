## MODIFIED Requirements

### Requirement: Instruction File Listing

The system SHALL list all known instruction files with their override status.

#### Scenario: List instruction files with status
- **WHEN** the system lists instruction files for the configuration UI
- **THEN** it returns the static role instruction filenames (`instructions.md`, `dev_instructions.md`, `admin_instructions.md`, `user_instructions.md`)
- **AND** for each configured repository, it includes `{repo-name}_changes_instructions.md` and `{repo-name}_worktree_setup_instructions.md`
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

#### Scenario: New repo instruction file (no default, no override)
- **GIVEN** a repo instruction file does not exist in either tier
- **WHEN** the admin UI lists instruction files
- **THEN** the file is shown with a "Create" button instead of "Edit" or "Customize"
- **AND** clicking "Create" opens a modal with empty content
- **AND** on submit, the content is written to `data/configuration/{filename}`

### Requirement: Modal Title Length

The edit modal title SHALL respect Slack's 24-character limit for modal titles.

#### Scenario: Filename fits within title limit
- **GIVEN** a filename is 24 characters or fewer
- **WHEN** the edit modal is opened
- **THEN** the full filename is used as the modal title

#### Scenario: Filename exceeds title limit
- **GIVEN** a filename exceeds 24 characters (e.g. repo instruction files)
- **WHEN** the edit modal is opened
- **THEN** the title is truncated to 23 characters with a trailing `…` character

## ADDED Requirements

### Requirement: Change Workflow Setup Instructions

The system SHALL provide setup instructions for enabling the change request workflow.

#### Scenario: Docker setup prompts for change workflow
- **WHEN** running `scripts/docker-setup.sh`
- **THEN** the script asks if the user wants to enable change requests
- **AND** explains that this allows devs to create PRs through Slack
- **AND** warns about the additional permissions required

#### Scenario: GitHub CLI authentication for changes
- **GIVEN** the user enables change workflow
- **WHEN** the setup script runs
- **THEN** it checks if `gh` CLI is authenticated
- **AND** provides instructions to run `gh auth login` if not
- **AND** explains that `gh` is required for PR creation

#### Scenario: SSH key write access warning
- **GIVEN** the user enables change workflow
- **WHEN** the setup script runs
- **THEN** it warns that the SSH key needs write access (not just read)
- **AND** explains how to update GitHub deploy key permissions

### Requirement: Worktree Volume Mount

The system SHALL support volume mounting for worktrees in Docker.

#### Scenario: Worktree volume in docker run command
- **GIVEN** change workflow is enabled
- **WHEN** the setup script outputs docker commands
- **THEN** it includes a volume mount for `data/worktrees/`
- **AND** the mount is read-write (not `:ro`)

#### Scenario: Worktree directory permissions
- **WHEN** the Docker container runs with change workflow enabled
- **THEN** the `clack` user has write permissions to `data/worktrees/`
- **AND** can create and delete directories

### Requirement: GitHub CLI in Docker Image

The system SHALL include GitHub CLI in the Docker image when change workflow is supported.

#### Scenario: gh CLI installed in image
- **WHEN** the Docker image is built
- **THEN** the `gh` CLI is installed and available in PATH
- **AND** the version is logged during container startup

#### Scenario: gh CLI authentication in container
- **WHEN** running the container with change workflow
- **THEN** `GH_TOKEN` environment variable is used for authentication
- **AND** the setup script prompts for and stores the token in `data/auth/.env`

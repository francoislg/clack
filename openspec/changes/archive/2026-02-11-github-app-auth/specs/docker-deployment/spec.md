## MODIFIED Requirements

### Requirement: Docker Setup Script
The system SHALL provide an interactive setup script that configures credentials required for Docker deployment.

#### Scenario: Script creates auth directory structure
- **WHEN** `scripts/docker-setup.sh` is executed
- **THEN** the script creates `data/auth/` directory if it doesn't exist

#### Scenario: Missing config file
- **WHEN** `data/config.json` does not exist
- **THEN** the script offers to copy from `data/config.example.json`
- **AND** opens the file in `$EDITOR` for customization

#### Scenario: GitHub App credential setup
- **WHEN** no `data/auth/github.json` exists
- **THEN** the script prompts for the App ID and Installation ID
- **AND** prompts for the path to the private key PEM file
- **AND** copies the PEM file to `data/auth/github-app.pem`
- **AND** saves credentials to `data/auth/github.json`

#### Scenario: GitHub App instructions displayed
- **WHEN** GitHub App credentials are not yet configured
- **THEN** the script displays instructions for creating a GitHub App
- **AND** lists the required permissions: `contents: read & write`, `pull_requests: read & write`, `metadata: read`
- **AND** explains how to install the app on the target organization
- **AND** explains where to find the App ID and Installation ID

#### Scenario: Slack credentials configuration
- **WHEN** no `data/auth/slack.json` exists
- **THEN** the script prompts for bot token, app token, and signing secret
- **AND** validates token formats (xoxb-* for bot, xapp-* for app)
- **AND** saves credentials to `data/auth/slack.json`

#### Scenario: API key configuration
- **WHEN** no `ANTHROPIC_API_KEY` is configured in `data/auth/.env`
- **THEN** the script prompts for the API key
- **AND** saves it to `data/auth/.env`

#### Scenario: Credential validation
- **WHEN** setup completes
- **THEN** the script validates the GitHub App PEM file exists and is readable
- **AND** validates Slack tokens match expected formats
- **AND** validates API key matches expected format (sk-ant-*)
- **AND** validates `data/config.json` exists and is readable

#### Scenario: Docker command output
- **WHEN** all validations pass
- **THEN** the script outputs the complete `docker build` and `docker run` commands

### Requirement: Dockerfile
The system SHALL provide a Dockerfile that builds a production-ready container image.

#### Scenario: Multi-stage build
- **WHEN** Docker image is built
- **THEN** TypeScript compilation occurs in a builder stage
- **AND** only production artifacts are copied to the final image

#### Scenario: Required system dependencies
- **WHEN** Docker image is built
- **THEN** the image includes git
- **AND** the image includes Claude Code CLI

#### Scenario: Non-root user
- **WHEN** container runs
- **THEN** the application runs as a non-root user named "clack"

#### Scenario: Volume mount points
- **WHEN** container runs
- **THEN** `/app/data/config.json` is mountable for configuration
- **AND** `/app/data/auth/` is mountable for credentials
- **AND** `/app/data/repositories/` is mountable for persistence

### Requirement: Auth Directory Structure
The system SHALL use a dedicated auth directory for all credentials.

#### Scenario: Auth directory gitignored
- **WHEN** credentials are stored in `data/auth/`
- **THEN** the contents are excluded from git via `.gitignore`
- **AND** the directory structure is preserved via `.gitkeep`

#### Scenario: GitHub App credentials location
- **WHEN** Docker container runs
- **THEN** GitHub App config is loaded from `data/auth/github.json`
- **AND** GitHub App private key is loaded from the path specified in `github.json`

#### Scenario: Slack credentials location
- **WHEN** Docker container runs
- **THEN** Slack tokens are loaded from `data/auth/slack.json`

#### Scenario: Environment file location
- **WHEN** Docker container runs
- **THEN** `ANTHROPIC_API_KEY` is loaded from `data/auth/.env`

### Requirement: Slack Credential Separation
The system SHALL load Slack credentials from a separate auth file.

#### Scenario: Slack auth file format
- **WHEN** `data/auth/slack.json` is read
- **THEN** it contains `botToken`, `appToken`, and `signingSecret` fields

#### Scenario: Config file without Slack secrets
- **WHEN** `data/config.json` is read
- **THEN** it does not contain Slack token fields
- **AND** it contains only non-sensitive configuration (reactions, repos, settings)

#### Scenario: Missing Slack auth file
- **WHEN** `data/auth/slack.json` does not exist
- **THEN** the application exits with clear error message
- **AND** the error message explains how to create the file or run setup script

#### Scenario: Migration from old config format
- **WHEN** setup script detects Slack tokens in `data/config.json`
- **THEN** it offers to migrate them to `data/auth/slack.json`
- **AND** removes tokens from `data/config.json` after successful migration

### Requirement: Docker Ignore
The system SHALL provide a `.dockerignore` file for build optimization.

#### Scenario: Exclude development files
- **WHEN** Docker image is built
- **THEN** `node_modules/`, `dist/`, `.git/`, and IDE files are excluded from context

#### Scenario: Exclude sensitive data
- **WHEN** Docker image is built
- **THEN** `data/config.json`, `data/auth/`, and `data/repositories/` are excluded from context

### Requirement: GCE Deployment Script
The system SHALL provide a deployment script for Google Compute Engine.

#### Scenario: Deploy to GCE
- **WHEN** `npm run deploy:gce` is executed
- **THEN** the script builds and pushes the Docker image to GCR
- **AND** creates or updates an e2-micro VM instance
- **AND** copies config/auth files to the instance
- **AND** runs the container with persistent volume for repositories

#### Scenario: GCE prerequisites check
- **WHEN** the deploy script runs
- **THEN** it verifies GCP project is set
- **AND** verifies auth files exist from docker-setup

#### Scenario: Existing instance update
- **WHEN** the instance already exists
- **THEN** the script prompts before updating
- **AND** pulls the latest image and restarts the container

### Requirement: Change Workflow Setup Instructions

The system SHALL provide setup instructions for enabling the change request workflow.

#### Scenario: Docker setup prompts for change workflow
- **WHEN** running `scripts/docker-setup.sh`
- **THEN** the script asks if the user wants to enable change requests
- **AND** explains that this allows devs to create PRs through Slack
- **AND** warns about the additional permissions required

#### Scenario: GitHub App permissions for changes
- **GIVEN** the user enables change workflow
- **WHEN** the setup script runs
- **THEN** it verifies the GitHub App has `contents: write` and `pull_requests: write` permissions
- **AND** explains that the App must be installed with write access on target repositories

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

## REMOVED Requirements

### Requirement: SSH key location
**Reason**: Replaced by GitHub App authentication. SSH keys are no longer needed.
**Migration**: Remove SSH keys from `data/auth/ssh/`. Configure GitHub App credentials in `data/auth/github.json` instead.

### Requirement: SSH key generation
**Reason**: Replaced by GitHub App private key. No SSH key generation needed.
**Migration**: Download the private key from the GitHub App settings page instead.

### Requirement: SSH key import
**Reason**: Replaced by GitHub App private key file.
**Migration**: Place the GitHub App `.pem` file at `data/auth/github-app.pem`.

### Requirement: GitHub instructions displayed
**Reason**: Replaced by GitHub App setup instructions.
**Migration**: Setup script now shows GitHub App creation instructions instead of deploy key instructions.

### Requirement: GitHub CLI authentication for changes
**Reason**: `gh` CLI is no longer used. All GitHub operations use Octokit with GitHub App tokens.
**Migration**: Remove `gh` CLI. PR operations are handled via Octokit API.

### Requirement: SSH key write access warning
**Reason**: SSH keys are no longer used. GitHub App permissions are configured at install time.
**Migration**: GitHub App must be installed with write access on repositories that support changes.

### Requirement: GitHub CLI in Docker Image
**Reason**: `gh` CLI is no longer needed. All GitHub operations use Octokit.
**Migration**: Remove `gh` CLI from Dockerfile. No replacement needed.

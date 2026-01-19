# docker-deployment Specification

## Purpose
TBD - created by archiving change add-docker-setup. Update Purpose after archive.
## Requirements
### Requirement: Docker Setup Script
The system SHALL provide an interactive setup script that configures credentials required for Docker deployment.

#### Scenario: Script creates auth directory structure
- **WHEN** `scripts/docker-setup.sh` is executed
- **THEN** the script creates `data/auth/ssh/` directory if it doesn't exist

#### Scenario: Missing config file
- **WHEN** `data/config.json` does not exist
- **THEN** the script offers to copy from `data/config.example.json`
- **AND** opens the file in `$EDITOR` for customization

#### Scenario: SSH key generation
- **WHEN** no SSH key exists in `data/auth/ssh/`
- **THEN** the script prompts to generate a new key or import an existing one
- **AND** generates an ED25519 key if "generate" is chosen
- **AND** copies the specified key if "import" is chosen

#### Scenario: SSH key import
- **WHEN** user chooses to import an existing SSH key
- **THEN** the script copies the private and public key to `data/auth/ssh/`
- **AND** sets correct permissions (600 for private key)

#### Scenario: GitHub instructions displayed
- **WHEN** SSH key is configured
- **THEN** the script displays the public key content
- **AND** shows the GitHub URL for adding deploy keys

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
- **THEN** the script validates SSH key permissions are 600
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
- **THEN** the image includes git and openssh-client
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

#### Scenario: SSH key location
- **WHEN** Docker container runs
- **THEN** SSH keys are expected at `data/auth/ssh/id_rsa`

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


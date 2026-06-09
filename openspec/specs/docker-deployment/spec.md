# docker-deployment Specification

## Purpose
TBD - created by archiving change add-docker-setup. Update Purpose after archive.
## Requirements
### Requirement: Docker Setup Script
The system SHALL provide an interactive setup script that configures credentials required for Docker deployment.

#### Scenario: Script creates auth directory structure
- **WHEN** `scripts/docker-setup.sh` is executed
- **THEN** the script creates `data/auth/` directory if it doesn't exist

#### Scenario: Missing config file
- **WHEN** `data/config.json` does not exist
- **THEN** the script offers to copy from `data/config.example.json`
- **AND** opens the file in `$EDITOR` for customization

#### Scenario: GitHub App credentials configuration
- **WHEN** no `data/auth/github.json` exists
- **THEN** the script prompts for GitHub App ID, Installation ID, and private key path
- **AND** copies the private key to `data/auth/github-app.pem`
- **AND** sets correct permissions (600 for private key)
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
- **THEN** the script validates GitHub App credentials exist and private key is present
- **AND** validates Slack tokens match expected formats
- **AND** validates Claude authentication is configured
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
- **AND** example files are preserved for reference

#### Scenario: GitHub App credentials location
- **WHEN** Docker container runs
- **THEN** GitHub App config is loaded from `data/auth/github.json`
- **AND** the private key is loaded from the path specified in the config

#### Scenario: Slack credentials location
- **WHEN** Docker container runs
- **THEN** Slack tokens are loaded from `data/auth/slack.json`

#### Scenario: Environment file location
- **WHEN** Docker container runs
- **THEN** Claude authentication is loaded from `data/auth/.env`
- **AND** supports either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`

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

#### Scenario: GitHub App write permissions for changes
- **GIVEN** the user enables change workflow
- **WHEN** the setup script runs
- **THEN** it explains that the GitHub App needs Contents: Read & write permission
- **AND** explains that the GitHub App needs Pull requests: Read & write permission

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

### Requirement: GitHub API Access via Octokit

The system SHALL use the Octokit library with GitHub App authentication for all GitHub API operations.

#### Scenario: Octokit client initialization
- **WHEN** the application starts
- **THEN** it validates GitHub App credentials (App ID, Installation ID, private key)
- **AND** generates a test installation token to verify access

#### Scenario: PR operations via Octokit
- **WHEN** change workflow is enabled
- **THEN** PR creation, merge, close, and review operations use Octokit API calls
- **AND** no external CLI tools are required for GitHub operations

### Requirement: GitHub MCP Server Binary

The system SHALL include the `github-mcp-server` binary in the Docker image.

#### Scenario: Binary installed during Docker build
- **WHEN** the Docker image is built
- **THEN** the `github-mcp-server` static binary is downloaded from the official GitHub releases
- **AND** installed to `/usr/local/bin/github-mcp-server`
- **AND** the version is controlled by a build arg `GITHUB_MCP_SERVER_VERSION`

#### Scenario: Binary works on Alpine
- **WHEN** the binary is downloaded
- **THEN** it is the `Linux_x86_64` variant (statically compiled, no glibc dependency)
- **AND** it runs correctly on the `node:18-alpine` base image

### Requirement: Status Port Published to Loopback

The GCE image-update deploy SHALL run the container with the runtime status port published to the VM's loopback interface only, so the deploy script can poll `GET /status` from the VM host. The port SHALL NOT be published on a public interface.

#### Scenario: Container publishes status port to localhost

- **WHEN** `scripts/gce-update-image.sh` runs the new container
- **THEN** the `docker run` command publishes the status port as `127.0.0.1:<port>:<port>`
- **AND** the port is reachable as `localhost:<port>` from the VM host
- **AND** it is not bound to a public address

### Requirement: Pre-Swap Drain Gate

Before stopping the old container, the deploy SHALL wait for the running bot to become idle by polling `GET /status` until `busy` is `false`, subject to a bounded maximum wait. The drain gate SHALL run after the no-downtime preparation phases and before the container swap, so the downtime window lands on an idle bot.

#### Scenario: Idle bot proceeds immediately

- **WHEN** the drain gate polls `GET /status`
- **AND** the response has `busy == false`
- **THEN** the deploy proceeds to the container swap without waiting

#### Scenario: Busy bot is waited on

- **WHEN** the drain gate polls `GET /status`
- **AND** the response has `busy == true`
- **AND** the maximum wait has not been exceeded
- **THEN** the deploy keeps waiting and re-polls
- **AND** it prints a progress line indicating the number of active runs and busy workers

#### Scenario: Bounded wait then proceed

- **WHEN** the bot is still `busy` after the maximum wait elapses
- **THEN** the deploy prints the still-active counts (active query runs and executing changes)
- **AND** proceeds with the container swap anyway

#### Scenario: Status unreachable does not block deploy

- **WHEN** the drain gate cannot reach `GET /status` (e.g. an older image without the endpoint)
- **THEN** the deploy logs that the drain check was skipped
- **AND** proceeds with the container swap

### Requirement: Deploy Skill Surfaces the Drain Phase

The `/deploy` skill SHALL surface the drain phase to the operator: its Monitor output filter SHALL match the drain progress markers, and its phase-acknowledgement guidance SHALL include the drain phase so the operator understands why the deploy may pause before the swap.

#### Scenario: Skill acknowledges the drain phase

- **WHEN** the deploy emits drain-phase output
- **THEN** the skill's Monitor filter captures the drain markers
- **AND** the skill has a phase-acknowledgement entry for the drain phase


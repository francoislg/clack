# github-app Specification

## Purpose

GitHub App authentication for all git operations and GitHub API calls. Provides org-owned identity with fine-grained permissions and short-lived tokens.

## Requirements

### Requirement: GitHub App Credential Configuration

The system SHALL load GitHub App credentials from a dedicated auth file.

#### Scenario: GitHub auth file format
- **WHEN** `data/auth/github.json` is read
- **THEN** it contains `appId`, `installationId`, and `privateKeyPath` fields
- **AND** `appId` is a numeric string identifying the GitHub App
- **AND** `installationId` is a numeric string identifying the org installation
- **AND** `privateKeyPath` is a path to the PEM file (default: `data/auth/github-app.pem`)

#### Scenario: Missing GitHub auth file
- **WHEN** `data/auth/github.json` does not exist
- **THEN** the application exits with a clear error message
- **AND** the error explains how to create a GitHub App and generate the file

#### Scenario: Missing private key file
- **WHEN** `data/auth/github.json` exists but the PEM file at `privateKeyPath` is not found
- **THEN** the application exits with a clear error message
- **AND** the error explains where to download the private key from GitHub App settings

#### Scenario: Example auth file provided
- **WHEN** a user sets up the project
- **THEN** `data/auth/github.example.json` exists with placeholder values
- **AND** documents the expected format

### Requirement: Installation Token Generation

The system SHALL generate short-lived GitHub installation tokens from the App credentials.

#### Scenario: Generate installation token on demand
- **WHEN** a GitHub API call or git operation is needed
- **THEN** the system generates an installation token using the App ID, installation ID, and private key
- **AND** the token is valid for GitHub API and HTTPS git operations

#### Scenario: Token caching
- **WHEN** an installation token is generated
- **THEN** the system caches the token in memory
- **AND** reuses it for subsequent requests until it approaches expiry

#### Scenario: Token refresh before expiry
- **WHEN** the cached token is within 5 minutes of expiry
- **THEN** the system generates a new token before the next operation
- **AND** replaces the cached token

#### Scenario: Token generation failure
- **WHEN** token generation fails (invalid credentials, network error)
- **THEN** the system logs the error with details
- **AND** the operation that requested the token fails with a descriptive error

### Requirement: Octokit Client Management

The system SHALL provide a configured Octokit client for GitHub API operations.

#### Scenario: Authenticated Octokit instance
- **WHEN** a GitHub API operation is needed
- **THEN** the system provides an Octokit client authenticated with the current installation token
- **AND** the client is configured for the GitHub.com API

#### Scenario: Startup validation
- **WHEN** the system starts
- **THEN** it validates the GitHub App credentials by generating a test token
- **AND** logs the authenticated App name and installation details
- **AND** exits with a clear error if validation fails

### Requirement: HTTPS Git URL Construction

The system SHALL construct authenticated HTTPS URLs for git operations.

#### Scenario: Construct authenticated clone URL
- **WHEN** a git clone or fetch operation is needed
- **THEN** the system constructs a URL in the format `https://x-access-token:{token}@github.com/{owner}/{repo}.git`
- **AND** uses a fresh installation token

#### Scenario: Repository shorthand resolution
- **WHEN** a repository URL is configured as `owner/repo` shorthand
- **THEN** the system resolves it to `https://github.com/owner/repo.git` for display
- **AND** adds the token for authenticated operations

#### Scenario: Full HTTPS URL support
- **WHEN** a repository URL is configured as `https://github.com/owner/repo.git`
- **THEN** the system extracts the owner/repo and constructs the authenticated URL
- **AND** strips any existing credentials from the URL

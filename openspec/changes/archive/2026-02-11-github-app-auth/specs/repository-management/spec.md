## MODIFIED Requirements

### Requirement: Repository Cloning
The system SHALL clone configured repositories to the local filesystem on startup.

#### Scenario: Clone repositories on first run
- **WHEN** the system starts and a configured repository is not present locally
- **THEN** the system clones the repository to `data/repositories/{repo-name}/`
- **AND** uses HTTPS authentication with a GitHub App installation token
- **AND** clones the configured branch

#### Scenario: Shallow clone for efficiency
- **WHEN** shallow clone is enabled in configuration
- **THEN** the system clones with `--depth` set to the configured value
- **AND** reduces disk usage and clone time

#### Scenario: Clone failure handling
- **WHEN** a repository clone fails (network, auth, etc.)
- **THEN** the system logs the error with details
- **AND** continues to operate with remaining repositories
- **AND** retries on the next sync interval

### Requirement: Periodic Repository Sync
The system SHALL periodically pull latest changes from configured repositories.

#### Scenario: Pull on configured interval
- **WHEN** the configured pull interval has elapsed since last sync
- **THEN** the system performs `git pull` on each cloned repository
- **AND** uses a fresh GitHub App installation token for authentication
- **AND** updates the local copy with remote changes

#### Scenario: Pull interval configurable
- **WHEN** the system reads configuration
- **THEN** it uses the `pullIntervalMinutes` value for sync scheduling
- **AND** defaults to 60 minutes if not specified

#### Scenario: Pull failure handling
- **WHEN** a pull operation fails
- **THEN** the system logs the error
- **AND** continues using the existing local copy
- **AND** retries on the next interval

### Requirement: Repository Configuration
The system SHALL support multiple repository configurations with metadata.

#### Scenario: Repository with description
- **WHEN** a repository is configured with a description
- **THEN** the description is passed to Claude Code for context
- **AND** helps Claude determine repository relevance to questions

#### Scenario: Repository branch selection
- **WHEN** a repository configuration specifies a branch
- **THEN** the system clones and pulls that specific branch
- **AND** defaults to `main` if not specified

#### Scenario: Repository URL formats
- **WHEN** a repository URL is configured
- **THEN** the system accepts `owner/repo` shorthand or full HTTPS URL (`https://github.com/owner/repo.git`)
- **AND** constructs authenticated HTTPS URLs using GitHub App installation tokens

## REMOVED Requirements

### Requirement: SSH Authentication
**Reason**: Replaced by GitHub App authentication. All git operations now use HTTPS with installation tokens.
**Migration**: Remove `git.sshKeyPath` from config. Configure GitHub App credentials in `data/auth/github.json` instead. Change repository URLs from SSH (`git@github.com:...`) to HTTPS format (`owner/repo` or `https://github.com/...`).

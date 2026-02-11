# repository-management Specification

## Purpose
TBD - created by archiving change add-slack-reaction-bot. Update Purpose after archive.
## Requirements
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

### Requirement: GitHub App Authentication
The system SHALL use GitHub App installation tokens for all git operations.

#### Scenario: Token-based HTTPS authentication
- **WHEN** a git operation requires authentication
- **THEN** the system generates an installation token via the GitHub App
- **AND** constructs an HTTPS URL with the token: `https://x-access-token:{token}@github.com/owner/repo.git`
- **AND** refreshes the token before each network operation

#### Scenario: Token caching
- **WHEN** an installation token is generated
- **THEN** the system caches it in memory
- **AND** reuses the cached token until 5 minutes before expiry
- **AND** generates a new token when the cache expires

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

### Requirement: Repository Storage Location
The system SHALL store all cloned repositories under `data/repositories/`.

#### Scenario: Repository directory structure
- **WHEN** repositories are cloned
- **THEN** each is stored at `data/repositories/{repo-name}/`
- **AND** the directory name matches the `name` field in configuration

#### Scenario: Data directory creation
- **WHEN** the system starts
- **THEN** it creates `data/repositories/` if it does not exist
- **AND** ensures proper permissions for the directory

### Requirement: Repository Change Support Configuration

The system SHALL support per-repository configuration for change requests.

#### Scenario: Enable changes for repository
- **WHEN** a repository config includes `supportsChanges: true`
- **THEN** change requests can target that repository
- **AND** worktrees will be created for changes

#### Scenario: Disabled changes for repository
- **WHEN** a repository config has `supportsChanges: false` or omits the field
- **THEN** change requests targeting that repository are rejected
- **AND** a message explains that changes are not enabled for this repo

#### Scenario: Custom worktree base path
- **WHEN** a repository config includes `worktreeBasePath`
- **THEN** worktrees are created under that path instead of the default
- **AND** the path is relative to the data directory

#### Scenario: Per-repository PR instructions
- **WHEN** a repository config includes `pullRequestInstructions`
- **THEN** the system reads the specified file path from the repository
- **AND** includes those instructions in Claude's prompt when creating PRs
- **AND** the path is relative to the repository root

#### Scenario: PR instructions file resolution
- **GIVEN** a repository config has `pullRequestInstructions: ".claude/skills/create-pr.md"`
- **WHEN** preparing to create a PR
- **THEN** the system reads that file from the worktree
- **AND** passes its contents as PR creation guidelines to Claude
- **AND** falls back to global `prInstructions` if the file is not found

#### Scenario: Merge strategy configuration
- **WHEN** a repository config includes `mergeStrategy`
- **THEN** that strategy is used when merging PRs for that repository
- **AND** valid values are: `squash`, `merge`, `rebase`
- **AND** defaults to `squash` if not specified

#### Scenario: Single change-enabled repository
- **GIVEN** only one repository has `supportsChanges: true`
- **WHEN** a change request is detected
- **THEN** the system targets that repository automatically

#### Scenario: Multiple change-enabled repositories
- **GIVEN** multiple repositories have `supportsChanges: true`
- **WHEN** a change request is detected
- **THEN** Claude analyzes the request to determine the relevant repository
- **AND** uses repository descriptions to match intent
- **AND** if ambiguous, asks the user to specify which repository

### Requirement: Worktree Lifecycle Management

The system SHALL manage git worktrees for isolated change execution.

#### Scenario: Create worktree for change
- **GIVEN** a change request targeting a repository with `supportsChanges: true`
- **WHEN** change execution begins
- **THEN** the system creates a new git worktree at `data/worktrees/{repo-name}/{branch-name}`
- **AND** the branch name follows the pattern `clack/{type}/{description}-{random}`
- **AND** the worktree is based on the repository's default branch

#### Scenario: Worktree directory structure
- **WHEN** worktrees are created
- **THEN** they are stored under `data/worktrees/{repo-name}/`
- **AND** each worktree has its own subdirectory named after the branch

#### Scenario: Worktree from main repository
- **WHEN** creating a worktree
- **THEN** the system uses `git worktree add` from the main repository in `data/repositories/`
- **AND** fetches latest changes before creating the worktree
- **AND** creates a new branch from the default branch HEAD

#### Scenario: Retain worktree after PR creation
- **GIVEN** a PR was successfully created
- **WHEN** the change workflow completes the initial PR creation
- **THEN** the worktree is retained for potential follow-up commands (review, update, merge)
- **AND** the session remains active for thread interactions

#### Scenario: Claude-directed cleanup after merge
- **GIVEN** a PR was successfully merged
- **WHEN** the merge workflow completes
- **THEN** Claude decides whether to delete the remote branch
- **AND** Claude removes the worktree if appropriate
- **AND** the cleanup decision is reported in the Slack thread

#### Scenario: Claude-directed cleanup after close
- **GIVEN** a PR was closed without merging
- **WHEN** the close workflow completes
- **THEN** Claude asks the user if the branch should be deleted or kept
- **AND** Claude acts on the user's preference
- **AND** the worktree is removed after the decision

#### Scenario: Cleanup worktree after failure
- **GIVEN** change execution or PR creation failed
- **WHEN** the configured retention period expires (default 24 hours)
- **THEN** the system removes the worktree
- **AND** removes the associated branch if not pushed

#### Scenario: Worktree cleanup on startup
- **WHEN** the system starts
- **THEN** it scans `data/worktrees/` for stale worktrees
- **AND** removes worktrees older than the retention period
- **AND** prunes orphaned worktree references with `git worktree prune`

### Requirement: Branch Naming Convention

The system SHALL generate branch names following a consistent pattern.

#### Scenario: Branch name generation
- **WHEN** creating a branch for a change request
- **THEN** the branch name follows the pattern `clack/{type}/{description}-{suffix}`
- **AND** `type` is one of: `fix`, `feat`, `refactor`, `docs`, `chore`
- **AND** `description` is a kebab-case summary (max 50 chars)
- **AND** `suffix` is a 6-character random alphanumeric string

#### Scenario: Type inference from request
- **WHEN** analyzing the change request
- **THEN** Claude determines the type based on keywords:
  - "fix", "bug", "error" → `fix`
  - "add", "implement", "new" → `feat`
  - "refactor", "clean up" → `refactor`
  - "document", "readme" → `docs`
  - default → `chore`


## ADDED Requirements

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

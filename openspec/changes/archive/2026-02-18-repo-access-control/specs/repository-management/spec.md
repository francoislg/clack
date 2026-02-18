## MODIFIED Requirements

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

### Requirement: Repository Change Support Configuration

The system SHALL derive change support from the `access.write` property.

#### Scenario: Enable changes for repository via access.write
- **GIVEN** a repository config has `access.write` set to a valid role
- **WHEN** the system evaluates change support
- **THEN** change requests can target that repository for users meeting the write threshold
- **AND** worktrees will be created for changes

#### Scenario: Read-only repository
- **GIVEN** a repository config omits `access.write`
- **WHEN** a change request targets that repository
- **THEN** the request is rejected
- **AND** a message explains that changes are not enabled for this repo

#### Scenario: Custom worktree base path
- **WHEN** a repository config includes `worktreeBasePath`
- **THEN** worktrees are created under that path instead of the default
- **AND** the path is relative to the data directory

#### Scenario: Merge strategy configuration
- **WHEN** a repository config includes `mergeStrategy`
- **THEN** that strategy is used when merging PRs for that repository
- **AND** valid values are: `squash`, `merge`, `rebase`
- **AND** defaults to `squash` if not specified

#### Scenario: Single change-enabled repository
- **GIVEN** only one repository has `access.write` defined
- **WHEN** a change request is detected
- **THEN** the system targets that repository automatically

#### Scenario: Multiple change-enabled repositories
- **GIVEN** multiple repositories have `access.write` defined
- **WHEN** a change request is detected
- **THEN** Claude analyzes the request to determine the relevant repository
- **AND** uses repository descriptions to match intent
- **AND** if ambiguous, asks the user to specify which repository

## REMOVED Requirements

### Requirement: Repository Change Support Configuration (legacy supportsChanges)
**Reason**: Replaced by `access.write` role threshold on repository config. The boolean `supportsChanges` field is removed.
**Migration**: Replace `"supportsChanges": true` with `"access": { "write": "dev" }` in repository config.

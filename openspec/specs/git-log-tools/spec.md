# git-log-tools Specification

## Purpose
Git history query tools (`git_log` and `deepen_history`) for accessing commit history on local repository clones in query mode.

## Requirements
### Requirement: git_log Query Tool

The system SHALL provide a `git_log` query tool that executes `git log` on local repository clones with arbitrary arguments.

#### Scenario: Basic git log execution

- **WHEN** Claude calls `git_log` with a `repo` name and `args` array
- **THEN** the tool resolves the repo path from `data/repositories/{repo}/`
- **AND** executes `git.raw(["log", ...args])` via `simple-git`
- **AND** returns the raw output string

#### Scenario: Git log with no args

- **WHEN** Claude calls `git_log` with only a `repo` name and no `args`
- **THEN** the tool executes `git.raw(["log"])` (default git log behavior)

#### Scenario: Response includes shallow clone metadata

- **WHEN** `git_log` returns its response
- **THEN** the response SHALL include:
  - `output`: the raw git log output string
  - `shallow`: boolean indicating if the repo is a shallow clone
  - `availableCommits`: number of commits currently available locally
  - `truncated`: boolean indicating if output was truncated

#### Scenario: Output truncation

- **WHEN** the raw git log output exceeds 100,000 characters
- **THEN** the tool truncates at 100,000 characters
- **AND** sets `truncated` to `true` in the response
- **AND** appends a warning message to the output

#### Scenario: Repository access validation

- **WHEN** Claude calls `git_log` with a repo name
- **THEN** the tool validates the repo exists in `getVisibleRepos()` for the current user's role
- **AND** returns an error listing available repos if the repo is not found or not accessible

#### Scenario: Repository directory not found

- **WHEN** the repo is configured but its directory does not exist at `data/repositories/{repo}/`
- **THEN** the tool returns an error indicating the repository has not been cloned yet

#### Scenario: Git command error

- **WHEN** `git.raw()` throws an error (e.g., invalid arguments)
- **THEN** the tool returns an error with the git error message

### Requirement: deepen_history Query Tool

The system SHALL provide a `deepen_history` query tool that fetches additional commit history for shallow-cloned repositories.

#### Scenario: Deepen by N commits

- **WHEN** Claude calls `deepen_history` with a `repo` name and a `commits` count
- **THEN** the tool refreshes the authenticated remote URL
- **AND** executes `git.raw(["fetch", "--deepen=N"])` where N is the commits count
- **AND** returns the updated shallow status and available commit count

#### Scenario: Full unshallow

- **WHEN** Claude calls `deepen_history` with a `repo` name and `full` set to `true`
- **THEN** the tool refreshes the authenticated remote URL
- **AND** executes `git.raw(["fetch", "--unshallow"])`
- **AND** returns the updated shallow status and available commit count

#### Scenario: Default deepen amount

- **WHEN** Claude calls `deepen_history` with neither `commits` nor `full` specified
- **THEN** the tool defaults to deepening by 100 commits

#### Scenario: Repository not shallow

- **WHEN** Claude calls `deepen_history` on a repository that is not a shallow clone
- **THEN** the tool returns a success response indicating the repo already has full history
- **AND** does NOT execute any fetch operation

#### Scenario: Repository access validation

- **WHEN** Claude calls `deepen_history` with a repo name
- **THEN** the tool validates the repo exists in `getVisibleRepos()` for the current user's role
- **AND** returns an error listing available repos if the repo is not found or not accessible

#### Scenario: Authenticated remote refresh

- **WHEN** `deepen_history` prepares to fetch
- **THEN** it refreshes the remote URL with a fresh GitHub App installation token before fetching
- **AND** uses the same `setAuthenticatedRemote()` pattern as `syncRepository()`

#### Scenario: Fetch error handling

- **WHEN** the fetch operation fails (network, auth, etc.)
- **THEN** the tool returns an error with the failure message
- **AND** the repository state is unchanged

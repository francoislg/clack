## MODIFIED Requirements

### Requirement: git_log Query Tool

The system SHALL provide a `git_log` query tool that executes `git log` on local repository clones. The tool SHALL accept an arbitrary `args` array (power path) and SHALL ALSO accept first-class `path`, `limit`, and `since` parameters that map to `git log` flags. When the resulting output exceeds the shared output budget, the tool SHALL refuse with an error suggesting how to narrow, rather than truncating.

#### Scenario: Basic git log execution

- **WHEN** Claude calls `git_log` with a `repo` name and `args` array
- **THEN** the tool resolves the repo path from `data/repositories/{repo}/`
- **AND** executes `git.raw(["log", ...args])` via `simple-git`
- **AND** returns the raw output string

#### Scenario: Git log with no args

- **WHEN** Claude calls `git_log` with only a `repo` name and no `args`, `path`, `limit`, or `since`
- **THEN** the tool executes `git.raw(["log"])` (default git log behavior)

#### Scenario: First-class path parameter

- **WHEN** Claude calls `git_log` with a `path` parameter (a string or array of strings)
- **THEN** the tool appends `-- <path>...` to the git log arguments so output is scoped to those paths

#### Scenario: First-class limit parameter

- **WHEN** Claude calls `git_log` with a numeric `limit` parameter
- **THEN** the tool adds `-n <limit>` to the git log arguments

#### Scenario: First-class since parameter

- **WHEN** Claude calls `git_log` with a `since` parameter
- **THEN** the tool adds `--since=<since>` to the git log arguments

#### Scenario: First-class params compose with args

- **WHEN** Claude calls `git_log` with both `args` and one or more of `path`/`limit`/`since`
- **THEN** the tool applies the first-class params in addition to the supplied `args`
- **AND** does NOT deduplicate flags (git's last-flag-wins semantics resolve any overlap)

#### Scenario: Response on success

- **WHEN** `git_log` returns a successful response
- **THEN** the response SHALL include:
  - `output`: the raw git log output string
  - `shallow`: boolean indicating if the repo is a shallow clone
  - `availableCommits`: number of commits currently available locally
- **AND** the response SHALL NOT include a `truncated` field

#### Scenario: Output exceeds budget — refuse with suggestions

- **WHEN** the raw git log output exceeds the shared output budget (`MAX_TOOL_OUTPUT_CHARS`)
- **THEN** the tool returns an error result instead of any output
- **AND** the error states the result was too large
- **AND** the error suggests concrete ways to narrow: add `limit`, scope with `path`, window with `since`/`--since`, compact with `--oneline`, or search content with `-S<string>`/`--grep`
- **AND** the tool does NOT truncate or return partial output

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

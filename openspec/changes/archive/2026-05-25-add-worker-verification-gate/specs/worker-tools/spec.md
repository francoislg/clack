## MODIFIED Requirements

### Requirement: git_push Tool

The system SHALL provide a `git_push` MCP tool that pushes the current branch to the remote origin, optionally running a configured verification gate before the push.

#### Scenario: Successful push with no verification configured

- **WHEN** Claude calls `git_push` and no verification_checks.json resolves for the repository
- **THEN** the tool refreshes the remote URL with a fresh installation token
- **AND** pushes the current branch to origin using `simple-git`
- **AND** returns `{ success: true }` with the pushed ref

#### Scenario: Successful push with verification gate passing

- **WHEN** Claude calls `git_push` and verification_checks.json resolves with one or more checks
- **THEN** the tool runs the configured verification gate against the worktree
- **AND** if the gate passes, refreshes the remote URL with a fresh installation token
- **AND** pushes the current branch to origin using `simple-git`
- **AND** returns `{ success: true }` with the pushed ref

#### Scenario: Verification gate fails within retry budget

- **WHEN** Claude calls `git_push` and the verification gate fails
- **AND** the retry budget is not yet exhausted
- **THEN** the tool does NOT push
- **AND** returns an error payload that names the failing check, includes its exit code, includes truncated combined output, and states the number of retry attempts remaining
- **AND** does NOT throw an exception

#### Scenario: Verification gate fails and budget is exhausted

- **WHEN** Claude calls `git_push` and the verification gate fails
- **AND** the retry budget is now exhausted
- **THEN** the tool does NOT push
- **AND** returns a terminal error payload that states the retry budget is exhausted and instructs the worker to stop attempting `git_push`
- **AND** does NOT throw an exception

#### Scenario: Push fails due to hook

- **WHEN** Claude calls `git_push`, the verification gate passes (or is disabled), and a pre-push hook rejects the push
- **THEN** the tool returns `{ success: false, error: "pre-push hook failed", details: "<hook output>" }`
- **AND** does NOT throw an exception

#### Scenario: Push fails due to auth

- **WHEN** Claude calls `git_push`, the verification gate passes (or is disabled), and authentication fails
- **THEN** the tool returns `{ success: false, error: "authentication failed", details: "<error message>" }`

#### Scenario: Push fails due to remote rejection

- **WHEN** Claude calls `git_push`, the verification gate passes (or is disabled), and the remote rejects the push (e.g., force-push protection)
- **THEN** the tool returns `{ success: false, error: "remote rejected", details: "<rejection reason>" }`

#### Scenario: Available in all worker invocations

- **WHEN** the tool server is built in worker mode
- **THEN** `git_push` is always registered regardless of the worker's purpose (execute, update, review, merge, or close)

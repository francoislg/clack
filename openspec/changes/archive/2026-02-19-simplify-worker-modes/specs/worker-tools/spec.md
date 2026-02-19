## MODIFIED Requirements

### Requirement: git_push Tool

The system SHALL provide a `git_push` MCP tool that pushes the current branch to the remote origin.

#### Scenario: Successful push

- **WHEN** Claude calls `git_push`
- **THEN** the tool refreshes the remote URL with a fresh installation token
- **AND** pushes the current branch to origin using `simple-git`
- **AND** returns `{ success: true }` with the pushed ref

#### Scenario: Push fails due to hook

- **WHEN** Claude calls `git_push` and a pre-push hook rejects the push
- **THEN** the tool returns `{ success: false, error: "pre-push hook failed", details: "<hook output>" }`
- **AND** does NOT throw an exception

#### Scenario: Push fails due to auth

- **WHEN** Claude calls `git_push` and authentication fails
- **THEN** the tool returns `{ success: false, error: "authentication failed", details: "<error message>" }`

#### Scenario: Push fails due to remote rejection

- **WHEN** Claude calls `git_push` and the remote rejects the push (e.g., force-push protection)
- **THEN** the tool returns `{ success: false, error: "remote rejected", details: "<rejection reason>" }`

#### Scenario: Available in all worker invocations

- **WHEN** the tool server is built in worker mode
- **THEN** `git_push` is always registered regardless of the worker's purpose (execute, update, review, merge, or close)

### Requirement: ensure_pr Tool

The system SHALL provide an `ensure_pr` MCP tool that creates a pull request or returns an existing one (idempotent).

#### Scenario: Create new PR

- **WHEN** Claude calls `ensure_pr` with a title and summary
- **THEN** the tool checks for an existing open PR on the branch
- **AND** if none exists, resolves the PR template, uses Claude's provided summary to fill it, and creates a PR via Octokit
- **AND** updates the session's `prUrl` and status to `pr_created` as a side effect
- **AND** returns `{ success: true, pr_url: "<url>", created: true }`

#### Scenario: PR already exists

- **WHEN** Claude calls `ensure_pr` and an open PR already exists for the branch
- **THEN** the tool returns `{ success: true, pr_url: "<url>", created: false }`
- **AND** updates the session's `prUrl` as a side effect

#### Scenario: PR creation fails

- **WHEN** Claude calls `ensure_pr` and the GitHub API returns an error
- **THEN** the tool returns `{ success: false, error: "PR creation failed", details: "<API error>" }`
- **AND** does NOT update session state

#### Scenario: Available in all worker invocations

- **WHEN** the tool server is built in worker mode
- **THEN** `ensure_pr` is always registered regardless of the worker's purpose

### Requirement: merge_pr Tool

The system SHALL provide a `merge_pr` MCP tool that merges a pull request.

#### Scenario: Successful merge

- **WHEN** Claude calls `merge_pr`
- **THEN** the tool merges the PR using the repository's configured merge strategy (squash/merge/rebase)
- **AND** deletes the remote branch
- **AND** removes the local worktree and deletes the local branch
- **AND** updates session status to `completed` and removes the session
- **AND** returns `{ success: true, merge_method: "<strategy>" }`

#### Scenario: Merge fails

- **WHEN** Claude calls `merge_pr` and the merge fails (conflicts, CI, permissions)
- **THEN** the tool returns `{ success: false, error: "merge failed", details: "<reason>" }`
- **AND** does NOT update session state

#### Scenario: Remote branch deletion fails after merge

- **WHEN** the merge succeeds but remote branch deletion fails
- **THEN** the tool still returns success
- **AND** includes a warning in the response: `{ success: true, warning: "branch deletion failed" }`

#### Scenario: Available in all worker invocations

- **WHEN** the tool server is built in worker mode
- **THEN** `merge_pr` is always registered regardless of the worker's purpose

### Requirement: close_pr Tool

The system SHALL provide a `close_pr` MCP tool that closes a pull request without merging.

#### Scenario: Successful close

- **WHEN** Claude calls `close_pr`
- **THEN** the tool closes the PR via the GitHub API
- **AND** removes the local worktree and deletes the local branch
- **AND** updates session status to `completed` and removes the session
- **AND** returns `{ success: true }`

#### Scenario: Close with branch deletion

- **WHEN** Claude calls `close_pr` with `delete_branch: true`
- **THEN** the tool closes the PR and deletes the remote branch
- **AND** returns `{ success: true, branch_deleted: true }`

#### Scenario: Close fails

- **WHEN** Claude calls `close_pr` and the GitHub API returns an error
- **THEN** the tool returns `{ success: false, error: "close failed", details: "<reason>" }`

#### Scenario: Available in all worker invocations

- **WHEN** the tool server is built in worker mode
- **THEN** `close_pr` is always registered regardless of the worker's purpose

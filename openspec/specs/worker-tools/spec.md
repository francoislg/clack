# worker-tools Specification

## Purpose
MCP tools available to Claude during worker invocations. These tools provide Claude with the ability to push code, manage PRs, and communicate progress back to Slack threads. All worker tools are registered unconditionally in worker mode and return structured responses instead of throwing exceptions.
## Requirements
### Requirement: git_push Tool

The system SHALL provide a `git_push` MCP tool that pushes the current branch to the remote origin. The tool refreshes the remote URL with a fresh installation token, refuses to push to a protected branch, and supports an optional lease-only force push. It does NOT run any local verification gate.

#### Scenario: Successful push

- **WHEN** Claude calls `git_push`
- **AND** the target branch is not a protected branch
- **THEN** the tool refreshes the remote URL with a fresh installation token
- **AND** pushes the current branch to origin using a same-name refspec (source branch = destination branch) via `simple-git`
- **AND** returns `{ success: true }` with the pushed ref

#### Scenario: Lease-only force push

- **WHEN** Claude calls `git_push` with `force: true`
- **THEN** the tool first runs `git fetch origin <branch>` (the current branch) and resolves the fetched remote tip via `FETCH_HEAD`
- **AND** pushes with an explicit lease `--force-with-lease=<branch>:<fetched-sha>` — the implicit `--force-with-lease` is unusable here because single-branch (shallow) clones have a fetch refspec that never maps feature branches, making git expect the remote branch to not exist and reject every push as "stale info"
- **AND** when the fetch reports the remote branch missing, leases against its absence (`--force-with-lease=<branch>:`)
- **AND** when the fetch fails for any other reason (auth, network), returns a structured error WITHOUT pushing
- **AND** NEVER uses a bare `--force`

#### Scenario: Refuses to push to a protected branch

- **WHEN** Claude calls `git_push` and the target branch equals the repository's default branch (`repo.branch` or `main`) or a protected-branch name (`main`, `master`)
- **THEN** the tool does NOT push
- **AND** returns an error indicating pushes to protected branches are not permitted
- **AND** does NOT throw an exception
- **AND** this check is a local static comparison against the default branch name and a fixed protected-name set (`main`, `master`); it does NOT depend on a GitHub API call or GitHub's branch-protection configuration

#### Scenario: Push fails due to hook

- **WHEN** Claude calls `git_push` and a pre-push hook rejects the push
- **THEN** the tool returns `{ success: false, error: "pre-push hook failed", details: "<hook output>" }`
- **AND** does NOT throw an exception

#### Scenario: Push fails due to auth

- **WHEN** Claude calls `git_push` and authentication fails
- **THEN** the tool returns `{ success: false, error: "authentication failed", details: "<error message>" }`

#### Scenario: Push fails due to remote rejection

- **WHEN** Claude calls `git_push` and the remote rejects the push (e.g., non-fast-forward, or a stale lease on a force push)
- **THEN** the tool returns `{ success: false, error: "remote rejected", details: "<rejection reason>" }`
- **AND** does NOT escalate to a bare `--force`

#### Scenario: Available in all worker invocations

- **WHEN** the tool server is built in worker mode
- **THEN** `git_push` is always registered regardless of the worker's purpose (execute, update, review, merge, or close)

### Requirement: ensure_pr Tool

The system SHALL provide an `ensure_pr` MCP tool that creates a pull request or returns an existing one (idempotent). The tool SHALL accept an OPTIONAL `reviewers` argument (a list of GitHub logins chosen by Claude's judgement). When reviewers are provided, the tool SHALL, after creating or locating the PR, issue a reviewer request via Octokit (`pulls.requestReviewers`) with the PR author excluded. The author's GitHub login is read from the tool's worker context (the plumbed-in requesting-user login), and author exclusion SHALL be case-insensitive (matching GitHub username semantics). The reviewer request SHALL be non-fatal: any failure (GitHub 422, non-collaborator, missing scope, or other error) SHALL be caught, logged, and surfaced as a warning in the result WITHOUT throwing or rolling back the created PR. When no `reviewers` argument is provided (or `requirePRReviewers` is disabled), the tool SHALL behave exactly as before — no reviewer request is made and no warning is emitted.

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

#### Scenario: Reviewers requested on successful PR

- **WHEN** Claude calls `ensure_pr` with a non-empty `reviewers` list and the PR is created or located
- **THEN** the tool requests those reviewers (excluding the PR author) via `pulls.requestReviewers`
- **AND** the PR result is returned with `success: true`

#### Scenario: Reviewer request failure is non-fatal

- **WHEN** the reviewer request fails after the PR exists
- **THEN** the tool still returns `success: true` with the PR url
- **AND** includes a non-fatal warning describing the reviewer failure
- **AND** does not roll back the created PR

#### Scenario: PR author excluded from requested reviewers

- **WHEN** the `reviewers` list includes the PR author's GitHub login (in any letter case)
- **THEN** the author is removed (case-insensitive match) before the reviewer request is issued
- **AND** when the author's GitHub login is unknown (the requester is unmapped), no exclusion is needed and the resolved list is requested as-is

#### Scenario: Empty or omitted reviewers list makes no reviewer request

- **WHEN** Claude calls `ensure_pr` with `reviewers: []` or omits the argument (or `requirePRReviewers` is disabled)
- **THEN** the tool creates/locates the PR and makes no `pulls.requestReviewers` call
- **AND** returns `success: true` with no warning (this is the normal no-reviewers path, distinct from the flag-enabled "could not resolve" case which DOES warn)

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

### Requirement: report_status Tool

The system SHALL provide a `report_status` MCP tool that sends a message to the Slack thread.

#### Scenario: Send progress message

- **WHEN** Claude calls `report_status` with a message string
- **THEN** the tool posts the message to the change thread using `chat.postMessage`
- **AND** returns `{ success: true }`

#### Scenario: Slack API fails

- **WHEN** Claude calls `report_status` and the Slack API returns an error
- **THEN** the tool returns `{ success: false, error: "slack error", details: "<error>" }`
- **AND** does NOT throw an exception

### Requirement: Worker Tools Never Throw

The system SHALL ensure all worker tools return structured error responses instead of throwing exceptions.

#### Scenario: Unexpected error in tool

- **WHEN** any worker tool encounters an unexpected error during execution
- **THEN** the tool catches the exception
- **AND** returns `{ success: false, error: "<error type>", details: "<message>" }`
- **AND** Claude receives the error as a normal tool response

### Requirement: Raw git push blocked in worker mode

The system SHALL register a `PreToolUse` hook on every worker SDK invocation that denies any `Bash` command invoking `git push`, so that all pushes are forced through the `git_push` tool (where the protected-branch refusal applies). Other git commands the worker needs — `fetch`, `pull`, `rebase` — are not affected.

#### Scenario: Bash git push is denied

- **WHEN** the worker's Claude attempts a `Bash` tool call whose command invokes `git push` (including `git push --force`, `git push --force-with-lease`, or pushing an explicit refspec)
- **THEN** the `PreToolUse` hook returns a deny decision with a reason steering Claude to the `git_push` tool
- **AND** the command does not run

#### Scenario: Non-push git commands are allowed

- **WHEN** the worker's Claude runs a `Bash` `git` command that is not a push (e.g. `git fetch`, `git pull`, `git rebase`, `git status`, `git add`, `git commit`)
- **THEN** the `PreToolUse` hook allows it
- **AND** the command runs normally

#### Scenario: git_push tool is not affected

- **WHEN** Claude calls the `git_push` MCP tool (`mcp__clack__git_push`)
- **THEN** the hook — which matches only the `Bash` tool — does not intercept it
- **AND** the push proceeds through the tool's own protected-branch and force-with-lease logic


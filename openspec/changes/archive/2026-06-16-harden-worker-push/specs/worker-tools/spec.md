## MODIFIED Requirements

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
- **THEN** the tool first runs `git fetch origin <branch>` (the current branch) so the lease's remote-tracking ref is fresh and not rejected as stale
- **AND** pushes with `--force-with-lease --force-if-includes`
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

## ADDED Requirements

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

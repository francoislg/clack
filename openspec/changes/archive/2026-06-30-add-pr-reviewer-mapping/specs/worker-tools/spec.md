## MODIFIED Requirements

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

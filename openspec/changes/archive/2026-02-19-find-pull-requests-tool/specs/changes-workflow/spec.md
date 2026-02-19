## MODIFIED Requirements

### Requirement: PR Operations via GitHub API

The system SHALL perform all PR operations through the GitHub API using Octokit.

#### Scenario: Ensure PR via API (idempotent create)
- **GIVEN** changes have been committed and pushed to a branch
- **WHEN** a PR needs to be created
- **THEN** the system first checks for an existing open PR on the branch using `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open`
- **AND** if an open PR exists, returns the existing PR URL without creating a duplicate
- **AND** if no open PR exists, creates a new PR using `POST /repos/{owner}/{repo}/pulls`
- **AND** sets the title, body, base branch, and head branch
- **AND** returns the PR URL on success

#### Scenario: Merge PR via API
- **GIVEN** a PR is open and ready to merge
- **WHEN** a merge is requested
- **THEN** the system uses Octokit to merge the PR (`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`)
- **AND** uses the configured merge strategy (squash, merge, or rebase)

#### Scenario: Close PR via API
- **GIVEN** a PR is open
- **WHEN** a close is requested
- **THEN** the system uses Octokit to close the PR (`PATCH /repos/{owner}/{repo}/pulls/{pull_number}`)
- **AND** sets the state to `closed`

#### Scenario: Get PR status via API
- **GIVEN** a PR URL exists in the session
- **WHEN** the system checks PR status
- **THEN** it uses Octokit to fetch the PR state (`GET /repos/{owner}/{repo}/pulls/{pull_number}`)
- **AND** returns `OPEN`, `MERGED`, or `CLOSED`

#### Scenario: Fetch PR review comments via API
- **GIVEN** a review command is triggered
- **WHEN** the system fetches PR feedback
- **THEN** it uses Octokit to get comments and reviews
- **AND** passes the feedback to Claude for implementation

#### Scenario: Delete remote branch via API
- **GIVEN** a PR has been merged or closed
- **WHEN** branch deletion is requested
- **THEN** the system uses Octokit to delete the branch (`DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}`)

#### Scenario: Push via git with token authentication
- **GIVEN** changes need to be pushed to a remote branch
- **WHEN** a push operation is needed
- **THEN** the system configures the remote URL with a fresh installation token
- **AND** uses `simple-git` to push over HTTPS

## MODIFIED Requirements

### Requirement: find_pull_requests Query Tool

The system SHALL provide a `find_pull_requests` query tool that queries GitHub for pull requests on a repository, filterable by state, branch, and date. List results SHALL be lean by construction — they SHALL NOT include PR bodies — and SHALL be paginated. Retrieving a single PR's full body/diff/reviews SHALL be delegated to the `github` MCP rather than this tool.

#### Scenario: Query PRs for a repository

- **WHEN** Claude calls `find_pull_requests` with a required `repo` parameter and a `state` filter (`open`, `closed`, `merged`, or `all`)
- **THEN** the tool queries the GitHub API for pull requests on that repository in the requested state
- **AND** returns a lean array of PR summaries, each containing `number`, `title`, `state`, `branch`, `author`, `createdAt`, `updatedAt`, `mergedAt` (when merged), and `url`
- **AND** the summaries SHALL NOT include the PR `body`
- **AND** only queries repositories the user has read access to

#### Scenario: Filter PRs by branch name

- **WHEN** Claude calls `find_pull_requests` with an optional `branch` parameter
- **THEN** the tool filters results to PRs whose head branch contains the given string (partial match)

#### Scenario: Filter PRs by date

- **WHEN** Claude calls `find_pull_requests` with an optional `since` (ISO 8601) parameter
- **THEN** the tool returns only PRs whose relevant date (merged date for `merged` state, otherwise updated date) is on or after `since`

#### Scenario: Paginated, capped results

- **WHEN** Claude calls `find_pull_requests` with optional `offset` and `limit` parameters
- **THEN** the tool applies state/branch/since filtering, then returns the `limit`-sized slice starting at `offset` (default `offset` 0, default and bounded `limit`)
- **AND** the response includes the total filtered count alongside the returned slice and the applied `offset`/`limit`, so further pages can be requested
- **AND** the returned slice stays within the shared output budget

#### Scenario: Fetch cap is surfaced

- **WHEN** the GitHub query returns a full page (the maximum PRs fetched in one request)
- **THEN** the response includes `fetchCapped: true`, signaling that older matching PRs may exist beyond the fetched page and that `total`/pagination are bounded to that page
- **AND** when the page is not full, `fetchCapped` is omitted

#### Scenario: Retrieving a single PR's body is delegated

- **WHEN** Claude needs a single PR's full body, diff, or reviews
- **THEN** the `find_pull_requests` tool description directs Claude to attach the `github` integration and fetch that PR by number
- **AND** `find_pull_requests` itself does NOT return PR body content

#### Scenario: Repository not found

- **WHEN** Claude calls `find_pull_requests` with a repo name not in configuration
- **THEN** the tool returns an error listing available repositories

#### Scenario: Repository not visible to user

- **WHEN** Claude calls `find_pull_requests` targeting a repo the user cannot read
- **THEN** the tool returns an error indicating the repo is not accessible

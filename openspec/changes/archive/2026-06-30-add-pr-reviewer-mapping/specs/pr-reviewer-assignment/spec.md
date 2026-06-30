## ADDED Requirements

### Requirement: requirePRReviewers Config Flag

The system SHALL provide a `requirePRReviewers` boolean configuration flag in `config.json`, defaulting to `false`, parsed through the boot config zod schema. When `false`, PR creation behaves exactly as before this change (no reviewers are requested). When `true`, the system SHALL attempt to request reviewers, chosen by Claude's judgement, on PRs opened in worker mode. The flag expresses intent only; it SHALL NOT act as a hard gate that prevents PR creation.

#### Scenario: Flag absent or false leaves PR creation unchanged

- **WHEN** `requirePRReviewers` is `false` or absent and `ensure_pr` opens a PR
- **THEN** no reviewer request is made
- **AND** PR creation behavior is identical to the pre-change behavior

#### Scenario: Flag enabled triggers reviewer request

- **WHEN** `requirePRReviewers` is `true` and `ensure_pr` opens a PR with a resolved non-empty reviewer list
- **THEN** the system requests those reviewers on the PR after creation

### Requirement: GitHub-to-Slack Reviewer Resolution

When reviewers are required and a candidate reviewer lacks a stored `github.username`, the system SHALL resolve the mapping from the target repository's collaborators — everyone with access to that repo (org members with repo access AND outside collaborators), NOT the whole organization roster — preferring an email-based join where available, and SHALL persist only high-confidence matches via `update_user`. A **high-confidence match** is a case-insensitive exact equality between the Slack user's profile email and a collaborator's email; anything weaker (name-only, partial, or domain-only) is **low-confidence**. Low-confidence matches SHALL be ignored entirely — never written via `update_user` and never requested as a reviewer; the user simply stays unmapped (a later run, or a human calling `update_user`, fills it in). The candidate pool SHALL be restricted to repository collaborators so that a requested reviewer is always eligible.

#### Scenario: Candidate pool is repository collaborators

- **WHEN** the system needs to find a GitHub login to request as reviewer
- **THEN** it draws candidates from the repository's collaborator list
- **AND** does not request a user who is not a collaborator on the repository

#### Scenario: Empty collaborator pool yields no reviewers

- **WHEN** the target repository has no collaborators (the collaborator list is empty)
- **THEN** the reviewer resolution yields no candidates
- **AND** the PR is created with no reviewer request
- **AND** a non-fatal warning is returned

#### Scenario: High-confidence email match is persisted

- **WHEN** a Slack user's email matches a collaborator's email
- **THEN** the system records that user's `github.username` via `update_user`
- **AND** uses it as a reviewer candidate

#### Scenario: Low-confidence guess is ignored

- **WHEN** only a name-based (non-email) match is available
- **THEN** the system does NOT write a `github.username` for that user
- **AND** does NOT request that user as a reviewer
- **AND** the user remains unmapped

#### Scenario: Missing email on either side cannot produce a high-confidence match

- **WHEN** the Slack user has no profile email, OR the candidate collaborator has no email exposed by the GitHub API
- **THEN** no high-confidence (exact email) match is possible for that candidate
- **AND** the candidate is treated as low-confidence — not written and not requested
- **AND** resolution continues with the remaining candidates

### Requirement: Reviewer Failures Never Fail PR Creation

The system SHALL always create the pull request regardless of reviewer resolution or request outcome. A reviewer request that fails (unresolved/empty list, GitHub 422, non-collaborator, missing scope, or any other error) SHALL be caught, logged, and surfaced as a non-fatal warning; it SHALL NOT throw out of PR creation nor roll back the created PR. The PR author SHALL always be excluded from the requested reviewers.

#### Scenario: Empty reviewer resolution still creates the PR

- **WHEN** `requirePRReviewers` is `true` but no reviewer can be resolved
- **THEN** the PR is created normally
- **AND** the result includes a non-fatal warning indicating reviewers could not be resolved (e.g. suggesting `update_user` to map GitHub names)

#### Scenario: requestReviewers error does not roll back the PR

- **WHEN** the reviewer request returns an error after the PR was created
- **THEN** the created PR is preserved
- **AND** the error is logged and surfaced as a warning, not thrown

#### Scenario: PR author excluded from reviewers

- **WHEN** the requesting user's GitHub login is in the candidate reviewer set
- **THEN** that login is removed before the reviewer request is made

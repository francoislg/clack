# tester-mode — delta

## MODIFIED Requirements

### Requirement: Test requests are staged via a run_test action intent

When the feature is enabled, Claude SHALL detect a test request (e.g. "test this PR") and stage a test intent via a `run_test` action tool that mirrors `propose_change`. The tool SHALL be available only to dev+ users. The staged intent SHALL identify the target repository and the branch/PR to test.

The tool SHALL accept an optional `new_branch: boolean` argument. When `new_branch` is `true`, the staged intent SHALL carry `resumeRemoteBranch: false`, so the run creates a fresh throwaway branch off the repository's default branch instead of resuming an existing remote branch. When `new_branch` is omitted or `false`, the staged intent SHALL carry `resumeRemoteBranch: true`, preserving existing behavior exactly. The tool description SHALL instruct Claude to use `new_branch: true` when the user asks to test or record current behavior (no PR in play) and to name the branch a throwaway slug (e.g. `test/record-feature-x`). The protected-branch guard SHALL apply in both modes.

The `test_focus` argument's description SHALL steer content by provenance: it SHALL instruct Claude to describe WHAT to exercise (flows, pages, behaviors) and to include details the user stated in the conversation (the tester cannot see the Slack thread), and it SHALL instruct Claude NOT to copy boot/setup knowledge obtained from recalled memories into the field — the tester receives learned setup notes directly through prompt injection, where they remain advisory and self-correcting, whereas `test_focus` lands in the operator-authoritative request description.

#### Scenario: Dev user requests a test in a thread

- **WHEN** a dev+ user says "test this PR" in a thread and the feature is enabled
- **THEN** Claude stages a `run_test` intent resolving the target repo and branch, surfaced to the user as a test action

#### Scenario: Below-threshold user requests a test

- **WHEN** a user below the dev role requests a test
- **THEN** the `run_test` tool is not offered and no tester run is started

#### Scenario: Target cannot be resolved

- **WHEN** a test is requested but no PR/branch can be resolved from the thread context and the request references a PR or branch
- **THEN** no intent is staged and Claude asks the user to name the branch or PR explicitly

#### Scenario: User asks to record current behavior without a PR

- **WHEN** a dev+ user asks to test or record a feature as it works today (no PR referenced)
- **THEN** Claude stages a `run_test` intent with `new_branch: true` and a throwaway branch name, and the staged intent carries `resumeRemoteBranch: false`

#### Scenario: new_branch omitted keeps resume semantics

- **WHEN** a `run_test` intent is staged without `new_branch`
- **THEN** the staged intent carries `resumeRemoteBranch: true`, byte-for-byte identical to pre-change behavior

#### Scenario: Protected branch still rejected with new_branch

- **WHEN** `run_test` is called with a protected branch name (e.g. `main`), regardless of `new_branch`
- **THEN** the tool returns an error and no intent is staged

#### Scenario: Memory-recalled setup facts stay out of test_focus

- **GIVEN** query-mode Claude recalled a `tester-setup:<repo>` memory before staging a test
- **WHEN** it composes the `run_test` call
- **THEN** the `test_focus` describes the flows to exercise and any user-stated details, without repeating the recalled entry's boot/setup facts (ports, seed strategy, auth workarounds)

#### Scenario: User-stated setup instructions still flow through

- **GIVEN** the user says "test it against the staging config" in the thread
- **WHEN** Claude stages the test
- **THEN** that user-stated instruction is included in `test_focus`, provenance — not content type — being the exclusion criterion

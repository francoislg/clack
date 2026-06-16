## ADDED Requirements

### Requirement: await_ci Tool

The system SHALL provide an `await_ci` MCP worker tool that resolves the CI status of the active change's pull request by polling GitHub check-runs for the PR head SHA, blocking server-side with bounded backoff until the checks resolve or a cap is reached, and returning a single verdict.

#### Scenario: All check-runs succeed

- **WHEN** Claude calls `await_ci` and every check-run for the PR head SHA completes with a success/neutral conclusion
- **THEN** the tool returns `{ state: "passed", failedChecks: [] }`

#### Scenario: A check-run fails

- **WHEN** Claude calls `await_ci` and at least one check-run for the head SHA completes with a failure/cancelled/timed-out conclusion
- **THEN** the tool stops waiting
- **AND** returns `{ state: "failed", failedChecks: [ { name, conclusion, detailsUrl } ... ] }`

#### Scenario: Checks do not resolve before the cap

- **GIVEN** check-runs are still queued or in progress
- **WHEN** the bounded polling cap is reached before they resolve
- **THEN** the tool returns `{ state: "timed_out", failedChecks: [], pendingChecks: [ <names of checks still queued/in-progress> ] }`

#### Scenario: No check-runs are registered for the head SHA

- **WHEN** Claude calls `await_ci` and GitHub reports no check-runs for the head SHA throughout the polling cap (none ever appear)
- **THEN** the tool returns `{ state: "pending", failedChecks: [], pendingChecks: [] }`
- **AND** does NOT report `passed`

#### Scenario: Tool never throws

- **WHEN** the GitHub API errors while polling
- **THEN** the tool returns a structured error result rather than throwing
- **AND** that error result is distinct from a `passed`/`failed` verdict, so a transient API error is never reported as CI having passed or failed

#### Scenario: Available in all worker invocations

- **WHEN** the tool server is built in worker mode
- **THEN** `await_ci` is registered regardless of the worker's purpose (execute, update, review, merge, or close)

### Requirement: Worker Verifies CI Before Signing Off

The system SHALL require a worker, after pushing and ensuring a pull request exists, to verify CI status via `await_ci` before reporting the change as successful, replacing the removed local pre-push verification gate.

#### Scenario: Sign off only on passing CI

- **GIVEN** the worker has pushed the branch and `ensure_pr` has created or returned the PR
- **WHEN** `await_ci` returns `state: "passed"`
- **THEN** the worker may report the change as successfully completed

#### Scenario: Failing CI is reported honestly

- **WHEN** `await_ci` returns `state: "failed"`
- **THEN** the worker does NOT report success
- **AND** surfaces the failing checks and either attempts a fix or calls `report_status` describing the CI failure

#### Scenario: Unresolved CI is not claimed as success

- **WHEN** `await_ci` returns `state: "timed_out"` or `state: "pending"`
- **THEN** the worker does NOT claim the change passed CI
- **AND** reports that CI did not conclusively pass (PR is open, checks unresolved)

#### Scenario: Worker workflow does not end on a blind push

- **WHEN** a worker completes implementation
- **THEN** its terminal sequence is push → `ensure_pr` → `await_ci` → status reporting gated on the CI verdict
- **AND** a bare `git_push` is not treated as the end of the change

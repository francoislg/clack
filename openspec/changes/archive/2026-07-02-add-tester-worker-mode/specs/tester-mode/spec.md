## ADDED Requirements

### Requirement: Tester feature is opt-in and inert by default

The tester feature SHALL be disabled unless `config.tester.enabled` is `true`. When disabled or absent, the `run_test` action tool, the tester toolbelt, and any tester Home Tab surface SHALL NOT be registered, and no tester behavior SHALL be observable. The tester config block SHALL be validated with a zod schema like all other config.

#### Scenario: Feature absent

- **WHEN** `config.tester` is absent or `enabled` is `false`
- **THEN** the `run_test` tool is not registered, no tester intent can be staged, and Clack behaves exactly as it did before this change

#### Scenario: Feature enabled

- **WHEN** `config.tester.enabled` is `true`
- **THEN** the `run_test` action tool is registered for eligible users and tester runs can be requested

#### Scenario: Malformed config block

- **WHEN** `config.tester` is present but malformed (e.g. `enabled` is not a boolean)
- **THEN** boot fails fast with a formatted zod error, consistent with the other boot-config readers

### Requirement: Test requests are staged via a run_test action intent

When the feature is enabled, Claude SHALL detect a test request (e.g. "test this PR") and stage a test intent via a `run_test` action tool that mirrors `propose_change`. The tool SHALL be available only to dev+ users. The staged intent SHALL identify the target repository and the branch/PR to test.

#### Scenario: Dev user requests a test in a thread

- **WHEN** a dev+ user says "test this PR" in a thread and the feature is enabled
- **THEN** Claude stages a `run_test` intent resolving the target repo and branch, surfaced to the user as a test action

#### Scenario: Below-threshold user requests a test

- **WHEN** a user below the dev role requests a test
- **THEN** the `run_test` tool is not offered and no tester run is started

#### Scenario: Target cannot be resolved

- **WHEN** a test is requested but no PR/branch can be resolved from the thread context
- **THEN** no intent is staged and Claude asks the user to name the branch or PR explicitly

### Requirement: Tester acquires a worktree on the target branch

A tester run SHALL acquire a worktree on the target PR's branch, reusing existing worktree provisioning (branch checkout, unique ports, `.env`, install step). It SHALL check the branch out from its own remote head using the existing `resumeRemoteBranch` cold-PR resume path so the PR's commits are preserved. A missing remote branch SHALL fail the run rather than clobber any branch.

#### Scenario: Branch exists on the remote

- **WHEN** a tester run targets an existing PR branch
- **THEN** the worktree is acquired from `origin/<branch>` with the PR's commits intact and the provisioned ports/`.env`

#### Scenario: Branch missing on the remote

- **WHEN** the target branch does not exist on the remote
- **THEN** the run fails with a clear error and no worktree or branch is modified

### Requirement: Tester toolbelt is strictly less privileged than a worker

The tester execution mode SHALL expose a distinct, gated tool set that omits all code-mutating and PR-mutating worker tools (`git_push`, `ensure_pr`, `merge_pr`, `close_pr`). Git access within a tester run SHALL be read-only: read operations (log, diff, status) remain available via Bash, while mutations are blocked — no authenticated push remote is refreshed for the run and the worker Bash guard rejects mutating git commands. The tester toolbelt SHALL include `report_status` and `record_and_upload`, and the official Playwright MCP SHALL be attached for the run as the browser-driving surface.

#### Scenario: PR-mutating tools absent in tester mode

- **WHEN** a tester run is executing
- **THEN** `git_push`, `ensure_pr`, `merge_pr`, and `close_pr` are not present in the available tool set

#### Scenario: Recording tool present in tester mode

- **WHEN** a tester run is executing
- **THEN** `record_and_upload` is available, the Playwright MCP tools are attached, and `report_status` is available for progress

### Requirement: Tester seeds test data when configured

When a per-repo `tester_data_setup_instructions.md` exists, a tester run SHALL execute it after boot to seed test data, following the same instruction-file resolution as `worktree_setup_instructions.md`. When absent, the run SHALL proceed without a seeding step.

#### Scenario: Repo provides data setup instructions

- **WHEN** the target repo has `tester_data_setup_instructions.md`
- **THEN** the tester runs those instructions after the app boots and before driving it

#### Scenario: Repo has no data setup instructions

- **WHEN** the target repo has no `tester_data_setup_instructions.md`
- **THEN** the tester skips seeding and proceeds to drive the app

#### Scenario: Data setup instructions fail

- **WHEN** `tester_data_setup_instructions.md` exists but its steps fail
- **THEN** the run aborts with a `report_status` narration of the failure and proceeds to teardown — it does not drive a partially-seeded app

### Requirement: Tester guarantees app process teardown

A tester run boots a long-lived application process. On completion, failure, or cancellation, the run SHALL terminate that process by port/PID, independent of worktree removal, so no dev server or held port leaks after the run ends. A failed kill (e.g. the process already exited) SHALL be logged and SHALL NOT block the remainder of cleanup.

#### Scenario: Run completes normally

- **WHEN** a tester run finishes
- **THEN** the app process it started is killed and its port is released

#### Scenario: Run crashes mid-drive

- **WHEN** a tester run errors before reaching teardown
- **THEN** cleanup still kills the started app process and releases its port

#### Scenario: Run is cancelled

- **WHEN** a user cancels an in-flight tester run (e.g. via the stop reaction)
- **THEN** cleanup kills the started app process and releases its port

### Requirement: Tester runs are bounded by a timeout

A tester run SHALL enforce a configurable overall timeout (following the existing changes-workflow timeout pattern). When boot, seed, or drive exceeds it, the run SHALL abort, narrate which phase timed out via `report_status`, and still execute full teardown.

#### Scenario: Run exceeds the timeout

- **WHEN** a tester run exceeds the configured timeout
- **THEN** the run aborts with a status message naming the phase that timed out, and teardown still kills the app process and releases its port

### Requirement: Tester runs report progress and are cancellable

A tester run SHALL post progress to the originating thread via `report_status` (as worker runs do) and SHALL be cancellable through the existing stop-reaction mechanism.

#### Scenario: User follows and cancels a run

- **WHEN** a tester run is in progress
- **THEN** progress updates appear in the thread, and reacting with the stop emoji cancels the run

### Requirement: Tester concurrency is capped

Tester runs SHALL be capped at a low, configurable concurrency (default 1) because each run adds a browser plus the application dev server on top of the worker and Claude. Tester acquisitions SHALL flow through the existing worker-pool queue with a separate tester cap; requests beyond the queue bound SHALL be rejected with a clear message (the existing `PoolExhausted` pattern) rather than oversubscribe the host.

#### Scenario: Concurrent test requests exceed the cap

- **WHEN** more tester runs are requested than the configured cap allows
- **THEN** excess requests queue FIFO up to the queue bound and are rejected with a clear message beyond it, and running tests are unaffected

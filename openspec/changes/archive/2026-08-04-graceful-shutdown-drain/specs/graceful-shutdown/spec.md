## ADDED Requirements

### Requirement: Signal-Driven Quiesce and Drain

On receiving a shutdown signal (SIGTERM or SIGINT), the process SHALL enter a graceful-shutdown sequence: it SHALL stop accepting new Claude runs, wait for every in-flight run to reach a terminal state, and then perform teardown and exit. The process SHALL NOT tear down schedulers, the Slack connection, or the process itself until in-flight runs have drained or the grace budget has elapsed.

#### Scenario: A shutdown signal begins drain instead of immediate exit

- **WHEN** the process receives SIGTERM or SIGINT
- **AND** one or more Claude runs are in flight
- **THEN** the process sets the quiescing state
- **AND** it does NOT immediately call `stopAll`, close the Slack connection, or exit
- **AND** it begins waiting for the in-flight runs to finish
- **AND** SIGTERM and SIGINT drive the identical drain sequence

#### Scenario: Idle process drains immediately

- **WHEN** the process receives SIGTERM
- **AND** no Claude runs are in flight (`busy` is false)
- **THEN** the process proceeds directly to teardown and exits with code 0

#### Scenario: Drain completes then exits cleanly

- **WHEN** the process is draining
- **AND** the last in-flight run reaches a terminal state before the grace budget elapses
- **THEN** the process performs teardown (`stopAll`, close status server, stop the Slack app)
- **AND** exits with code 0

### Requirement: Quiesce Gate at Run-Creation Choke Points

While the process is quiescing, the three run-creation choke points — the query-run entry (`processMessage`), the worker/tester-run entry (`executeChange`), and the cron dispatch (`executeJob`) — SHALL refuse to start new runs. A refused run SHALL NOT be registered in the active-runs registry or the changes active-state, so the set of in-flight runs is monotonically non-increasing once quiescing begins.

#### Scenario: Interactive trigger refused during quiesce

- **WHEN** the process is quiescing
- **AND** a DM or @mention would start a new query run via `processMessage`
- **THEN** no run is started and none is registered in the active-runs registry
- **AND** the user receives an ephemeral, localized notice that the bot is restarting and to try again shortly

#### Scenario: Worker run refused during quiesce

- **WHEN** the process is quiescing
- **AND** a change or tester run would start via `executeChange`
- **THEN** no worker run is started and none is added to the changes active-state
- **AND** the staged change remains staged for re-engagement after restart

#### Scenario: Cron fire skipped during quiesce

- **WHEN** the process is quiescing
- **AND** a scheduled cron slot would fire via `executeJob`
- **THEN** the fire is skipped and no run is started
- **AND** the skipped fire is eligible for recovery by cron catch-up on the next boot

#### Scenario: Quiesce check precedes registration

- **WHEN** a new run begins processing at a choke point at the moment the quiescing flag is set
- **THEN** the `isQuiescing()` check runs before the run is registered in the active-runs registry or changes active-state
- **AND** the run is refused, so the in-flight set never grows after quiescing begins

### Requirement: Bounded Grace Budget

The drain SHALL be bounded by a grace budget (configurable via env/config, default 300 seconds). An absent, invalid, or non-positive configured value SHALL fall back to the 300-second default. When the budget elapses with runs still in flight, the process SHALL stop the remaining runs, log the set of cancelled runs, and proceed to teardown and exit rather than waiting indefinitely.

#### Scenario: Straggler past budget is cancelled

- **WHEN** the process has been draining for the full grace budget
- **AND** one or more runs are still in flight
- **THEN** the process calls `stop` on each remaining run handle
- **AND** logs which runs were cancelled
- **AND** proceeds to teardown and exits

#### Scenario: Budget is configurable

- **WHEN** the grace budget is set via env/config to a valid positive value
- **THEN** the drain uses that value as its maximum wait
- **AND** absent an override, or given an invalid or non-positive value, the budget defaults to 300 seconds

### Requirement: Second Signal Forces Exit

While a drain is already in progress, a second shutdown signal SHALL force an immediate exit, overriding the remaining drain wait. On a forced exit, in-flight worker/tester runs retain their persisted state for resume after restart per the existing worker/tester persistence contract; query runs are abandoned (the user re-asks). The drain orchestration SHALL be idempotent so that repeated signals do not stack multiple drains.

#### Scenario: Second SIGTERM forces immediate exit

- **WHEN** the process is already draining from a first signal
- **AND** it receives a second SIGTERM or SIGINT
- **THEN** the process exits immediately without waiting for the remaining budget
- **AND** in-flight worker/tester runs retain their persisted state for post-restart resume, while query runs are abandoned

#### Scenario: Repeated signals do not stack drains

- **WHEN** the process is draining
- **AND** it receives additional signals
- **THEN** only the first signal's drain orchestration is active
- **AND** no additional concurrent drain is started

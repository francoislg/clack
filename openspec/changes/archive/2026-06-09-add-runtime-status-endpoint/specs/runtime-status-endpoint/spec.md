## ADDED Requirements

### Requirement: Runtime Status HTTP Server

The system SHALL run an HTTP server, separate from the Slack Socket Mode connection, that serves runtime status. The server SHALL bind to the loopback interface (`127.0.0.1`) only, on a configurable port (env/config, default `8787`). The server SHALL be started during the boot sequence and SHALL NOT affect Slack connectivity. If the server fails to start (e.g. port in use), the failure SHALL be logged and the bot SHALL continue running — runtime status is auxiliary and never blocks startup.

#### Scenario: Server starts on boot

- **WHEN** the application boots
- **THEN** an HTTP server listens on `127.0.0.1:<port>`
- **AND** the Slack Socket Mode connection is unaffected

#### Scenario: Server bound to loopback only

- **WHEN** the status server is listening
- **THEN** it is reachable from the host as `localhost:<port>`
- **AND** it is not bound to a public interface

#### Scenario: Server start failure is non-fatal

- **WHEN** the status server cannot bind its port (already in use or otherwise)
- **THEN** the error is logged
- **AND** the bot continues its normal startup and runs without the status endpoint

### Requirement: GET /status Snapshot

The status server SHALL respond to `GET /status` with a JSON body computed live at request time (no cached or background-refreshed state). The body SHALL include the process `version`, `uptimeSec`, an `activeRuns` object, a `workers` object, and a convenience `busy` boolean.

- `activeRuns` SHALL contain `count` and a `runs` array; each run entry SHALL include `channel`, `thread`, `status`, and `ageMs`.
- `workers` SHALL report in-flight Changes-Workflow runs in a mode-independent way: an `active` count of changes whose Claude run handle is currently executing (`status === "running"`), and a `changes` array with per-change `{ repo, branch, status, ageMs }`. A change that exists but is not currently executing Claude (e.g. awaiting follow-ups after its PR was created) SHALL NOT be counted in `active`. When the reusable worker pool is in use, the per-repo pool busy/idle breakdown MAY additionally be surfaced; it SHALL NOT be the source of the `active` count (the pool snapshot is empty in disposable mode).
- `busy` SHALL be `true` when `activeRuns.count > 0` OR `workers.active > 0`, and `false` otherwise.

#### Scenario: Idle bot reports not busy

- **WHEN** `GET /status` is requested
- **AND** there are no active query runs and no executing Changes-Workflow runs
- **THEN** the response has `activeRuns.count == 0`
- **AND** `workers.active == 0`
- **AND** `busy == false`

#### Scenario: Active query run is reported

- **WHEN** a query run is registered in the active-runs registry
- **AND** `GET /status` is requested
- **THEN** `activeRuns.count` is at least 1
- **AND** the corresponding `runs` entry includes its `channel`, `thread`, `status`, and an `ageMs` reflecting how long the run has been active
- **AND** `busy == true`

#### Scenario: Executing Changes-Workflow run is reported

- **WHEN** a Changes-Workflow run is executing (its run handle status is `"running"`)
- **AND** `GET /status` is requested
- **THEN** `workers.active` is at least 1
- **AND** the corresponding `changes` entry includes its `repo`, `branch`, `status`, and an `ageMs`
- **AND** `busy == true`

#### Scenario: Idle change awaiting follow-up is not counted

- **WHEN** a change exists in an active but non-executing state (e.g. `pr_created`, no run handle currently `"running"`)
- **AND** `GET /status` is requested
- **THEN** that change is NOT counted in `workers.active`
- **AND** if no other work is in flight, `busy == false`

#### Scenario: Status is computed per request

- **WHEN** an active run settles between two `GET /status` requests
- **THEN** the later response reflects the now-lower `activeRuns.count` without any restart or cache invalidation

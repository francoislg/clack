## ADDED Requirements

### Requirement: Tester prompt forbids ending the turn to wait

The tester system prompt SHALL state, as a hard rule, that the run terminates the instant Claude ends its turn (stops calling tools), that background task notifications are delivered only while the turn is open, and that Claude MUST NEVER end its turn to wait for a background task, monitor notification, build, or bundle — long-running conditions MUST be awaited by polling with Bash within the open turn.

#### Scenario: Hard rule present in the assembled prompt

- **WHEN** the tester system prompt is assembled for any run
- **THEN** it contains the turn-end hard rule — stating both that the run terminates when Claude stops calling tools and that Claude must never end the turn to wait — independent of repo-specific instruction overrides

### Requirement: Tester deliverable gate

A tester run whose SDK query ends successfully WITHOUT having called `record_and_upload` or `report_status` SHALL NOT be treated as a completed run. The harness MUST detect this case by observing tool-use events from the run's event stream (no instrumentation inside the tools) and trigger the corrective-resume path. A run that called at least one of the two deliverable tools passes the gate unchanged.

#### Scenario: Run ends with no deliverables

- **WHEN** the tester SDK query returns success and neither `record_and_upload` nor `report_status` appeared in the run's tool-use events
- **THEN** `executeTest` does not return success and initiates exactly one corrective resume of the SDK session

#### Scenario: Report-only run passes the gate

- **WHEN** the tester reported a boot or seed failure via `report_status` and stopped without recording
- **THEN** the gate does not trip and the run completes as it does today

#### Scenario: Recording delivered

- **WHEN** the tester called `record_and_upload` during the run
- **THEN** the gate does not trip

### Requirement: Corrective resume, then loud failure

On a tripped deliverable gate, the harness SHALL resume the same SDK session once (via the existing `resumeSessionId` mechanism), with the same toolbelt and MCP servers, a reduced timeout (the smaller of 15 minutes and the configured tester timeout), and a corrective prompt instructing Claude to finish now — close the browser session, deliver the recording that exists via `record_and_upload`, and narrate via `report_status`. App-process teardown MUST NOT occur between the initial run and the corrective resume. If the resume cannot restore the original session (resume-fallback to a fresh session, surfaced by the SDK wrapper's explicit fallback signal — session-id comparison is unreliable because a successful resume may mint a new id) or the resumed turn ALSO ends without a deliverable tool call, the run SHALL fail with an error message that reaches the Slack thread and explains that the run ended without delivering a recording or status report — a gated tester run MUST never end silently. On a surfaced fallback the harness SHALL also abort the fresh-session run rather than let the context-free corrective prompt execute.

#### Scenario: Corrective resume delivers

- **WHEN** the gate trips and the resumed session calls `record_and_upload` and/or `report_status`
- **THEN** the run completes successfully and the thread receives the deliverables

#### Scenario: Corrective resume also fails to deliver

- **WHEN** the gate trips and the resumed turn ends without calling either deliverable tool
- **THEN** `executeTest` returns failure with an error explaining the run ended without delivering, and the failure is posted to the thread

#### Scenario: Session cannot be resumed

- **WHEN** the gate trips and the SDK wrapper falls back to a fresh session because the original session is missing
- **THEN** the harness abandons the corrective attempt and fails loudly with the same error path

#### Scenario: Only one corrective attempt

- **WHEN** a corrective resume has already been attempted for a run
- **THEN** no further resumes are attempted regardless of outcome

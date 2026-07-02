## ADDED Requirements

### Requirement: Browser driving runs in an isolated sidecar

The tester SHALL drive a headless browser via the official Playwright MCP server running inside a separate, opt-in sidecar container, exposed over HTTP and registered as a remote MCP server for tester runs only. Clack's main image SHALL carry no Playwright footprint (no browser binaries, no Playwright client). The sidecar SHALL be reachable from the main container over a shared network, and the worktree's dev server SHALL listen on an interface reachable from the sidecar (not localhost-only) so the browser can drive it.

#### Scenario: Sidecar deployed and reachable

- **WHEN** the tester feature is enabled and the Playwright sidecar is running
- **THEN** the tester connects to the sidecar, drives the browser against the worktree dev server, and records the session

#### Scenario: Sidecar not deployed

- **WHEN** the tester feature is enabled but the sidecar is unreachable
- **THEN** the run aborts at startup with a clear status message (before booting the app), no partial/broken artifact is produced, and worker/query modes are unaffected

### Requirement: Recording is produced as an mp4

The recording SHALL be captured headlessly (no display server) by the MCP's own browser session and written to a volume shared by the sidecar and main containers. Playwright's native `webm` output SHALL be transcoded to `mp4` via ffmpeg in the main container (reading from the shared volume) before upload, so the artifact plays inline reliably in Slack.

#### Scenario: Session recorded and transcoded

- **WHEN** a tester run drives the app to completion
- **THEN** a `webm` recording is captured and transcoded to `mp4` before upload

#### Scenario: Recording or transcode fails

- **WHEN** the recording cannot be captured or the `webm→mp4` transcode fails
- **THEN** no corrupted artifact is uploaded and the failure is narrated via `report_status`

### Requirement: Recording is delivered to the Slack thread

The `record_and_upload` tool SHALL upload the finished `mp4` to the originating Slack thread via the existing `filesUploadV2` path. GitHub delivery is NOT part of this capability (deferred to a follow-up change) — a request to deliver the video to GitHub SHALL be declined with an explanation (noting that the REST API cannot attach video to a PR/issue comment, and branch-commit/release-asset delivery is planned as a follow-up), while the Slack upload still proceeds.

#### Scenario: Upload to Slack thread

- **WHEN** the request targets Slack
- **THEN** the `mp4` is uploaded to the originating thread via `filesUploadV2`

#### Scenario: Slack upload fails

- **WHEN** `filesUploadV2` fails (network error, file-size limit)
- **THEN** the error is narrated via `report_status` and the run reports the recording as not delivered

#### Scenario: GitHub delivery requested

- **WHEN** the request asks for the video to be delivered to GitHub
- **THEN** the tool declines with an explanation that v1 delivery is Slack-only, and the video is still uploaded to the Slack thread

### Requirement: Sidecar misconfiguration surfaces as a configuration error

A misconfigured sidecar endpoint or a missing shared recordings volume SHALL surface as a clear configuration error narrated via `report_status`, not an obscure protocol failure or a silently absent artifact. (Playwright client/browser version drift is structurally impossible — both live together in the sidecar.)

#### Scenario: Recording volume not mounted

- **WHEN** a run completes but the recording cannot be found on the shared volume
- **THEN** the failure is narrated via `report_status` as a configuration error naming the expected volume path, and no upload is attempted

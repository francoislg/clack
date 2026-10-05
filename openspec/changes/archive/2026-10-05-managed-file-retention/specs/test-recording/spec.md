## MODIFIED Requirements

### Requirement: Delivered recording is a verified demo take

The tester SHALL verify the change in a throwaway browser session BEFORE recording the deliverable: the run first explores and confirms the behavior under test (gathering evidence from page snapshots, console, and network), closes that browser session, then reopens the browser for a deliberate demo walkthrough of exactly what was verified. Because the sidecar records per browser context, the uploaded video SHALL cover only the demo session — not the exploration. When verification shows the feature broken, the demo take SHALL be a clean, minimal reproduction of the failure. Evidence from the verify phase SHALL be narrated via `report_status`; the verify session's recording file is left on the shared volume by the run, and is removed later only by the managed-files retention sweep (the recordings root's never-uploaded window).

#### Scenario: Feature verified working

- **WHEN** the verify session confirms the change behaves as intended
- **THEN** the tester closes the verify session, records a focused demo walkthrough in a fresh browser session, and uploads only that demo recording

#### Scenario: Feature verified broken

- **WHEN** the verify session shows the change failing
- **THEN** the demo take is a minimal reproduction of the failure, the recording is still uploaded, and the narration states clearly what is broken

#### Scenario: Verify take is not the uploaded video

- **WHEN** both the verify session and the demo session have produced recordings on the shared volume
- **THEN** `record_and_upload` delivers the demo take — selected as the most recently modified recording on the shared volume, which is the most recently closed context — and the verify take remains on disk, not uploaded, until the retention sweep removes it

#### Scenario: Demo session produces no recording

- **WHEN** the verify session recorded but the demo session fails to produce a recording (run error, timeout, or the demo browser was never closed)
- **THEN** `record_and_upload` degrades to delivering the newest recording available (the verify take — pre-change whole-session behavior), and the narration reports what happened rather than failing the run

### Requirement: Recording is produced as an mp4

The recording SHALL be captured headlessly (no display server) by the MCP's own browser session and written to a volume shared by the sidecar and main containers — the `recordings` managed root. Playwright's native `webm` output SHALL be transcoded to `mp4` via ffmpeg in the main container (reading from the shared volume) before upload, so the artifact plays inline reliably in Slack; the `mp4` path SHALL be obtained through the managed-files `reservePath` API so the output is tagged at creation, and a successful upload SHALL be recorded in the file ledger. The transcode SHALL condense idle video: near-duplicate frames (frozen stretches between browser actions) are dropped and the remaining frames re-timed, bounded by a pace floor (a maximum consecutive-drop count) so held states remain briefly visible and the playback stays human-followable. The pace floor is a fixed, implementation-tuned constant — not user-configurable. The mp4's duration therefore tracks on-screen activity, not the session's wall-clock time.

#### Scenario: Session recorded and transcoded

- **WHEN** a tester run drives the app to completion
- **THEN** a `webm` recording is captured and transcoded to `mp4` before upload
- **AND** the `mp4` has a ledger entry from creation, and gains `uploadedAt` once uploaded

#### Scenario: Idle stretches are condensed

- **WHEN** the recorded session contains stretches where the page does not visibly change
- **THEN** the transcoded `mp4` compresses those stretches per the pace floor, and periods of real activity play at normal speed

#### Scenario: Recording or transcode fails

- **WHEN** the recording cannot be captured or the `webm→mp4` transcode fails
- **THEN** no corrupted artifact is uploaded and the failure is narrated via `report_status`

## ADDED Requirements

### Requirement: Recordings are retained for a bounded time

Recordings on the shared volume (`webm` takes and `mp4` transcodes) SHALL be deleted by the managed-files retention sweep under the `recordings` root's windows — by default 14 days after upload, 24 hours after creation for a take never uploaded — and never while a tester run is in progress.

#### Scenario: Old uploaded recording

- **WHEN** an `mp4` was uploaded 15 days ago
- **THEN** the next sweep deletes it

#### Scenario: Verify take never uploaded

- **WHEN** a verify-session recording was created 30 hours ago and never uploaded
- **THEN** the next sweep deletes it

#### Scenario: Tester run in progress

- **WHEN** a tester run holds the tester slot during a sweep
- **THEN** no recording is deleted in that sweep

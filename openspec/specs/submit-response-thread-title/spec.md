# submit-response-thread-title Specification

## Purpose
TBD - created by archiving change add-claude-authored-thread-title. Update Purpose after archive.
## Requirements
### Requirement: Claude-Authored DM Thread Title Field

The `submit_response` tool SHALL expose an optional `thread_title` field — a short conversation label authored by Claude — **only** when the run's trigger is `directMessages`. For every other trigger (reactions, @mentions, scheduled/cron, worker), the field SHALL NOT appear in the schema, leaving those schemas unchanged. The value SHALL be carried on the existing `SubmitResponsePayload` so it flows out of `processMessage` on `ClaudeResponse.response` without additional result-threading. `thread_title` is on the via-Claude path — Claude writes it in the configured language and it SHALL NOT be routed through `t()`.

#### Scenario: Field present for DM triggers
- **WHEN** the `submit_response` schema is built for a `directMessages` trigger
- **THEN** the schema includes an optional `thread_title` string field

#### Scenario: Field absent for non-DM triggers
- **WHEN** the `submit_response` schema is built for a reactions, @mention, scheduled, or worker trigger
- **THEN** the schema does not include `thread_title`

#### Scenario: Value flows out on the payload
- **WHEN** Claude calls `submit_response` with a `thread_title` on a DM turn
- **THEN** the value is present on `ClaudeResponse.response.thread_title`

### Requirement: Agent DM Title Prefers Claude's Label

When titling an agent DM thread on its opening turn, the system SHALL use Claude's `thread_title` when present, and SHALL fall back to the truncated opening-message text when it is absent. The title SHALL still be set once, on the opening turn — follow-up turns SHALL NOT retitle. Titling remains best-effort: a `setTitle` failure SHALL NOT affect the answer.

#### Scenario: Claude-authored title wins
- **WHEN** a DM turn opens a thread and its `submit_response` carried a `thread_title`
- **THEN** the thread title is set to that label

#### Scenario: Fallback to message text
- **WHEN** a DM turn opens a thread and its `submit_response` carried no `thread_title`
- **THEN** the thread title is set to the truncated opening-message text

#### Scenario: Follow-ups do not retitle
- **WHEN** a DM turn continues an existing thread (carries a `thread_ts`)
- **THEN** no `setTitle` call is made for that turn


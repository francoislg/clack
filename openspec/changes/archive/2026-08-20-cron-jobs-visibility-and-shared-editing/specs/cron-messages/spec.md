# cron-messages — Delta

## MODIFIED Requirements

### Requirement: Cron Job Data Model

The system SHALL persist scheduled messages as cron jobs in `data/state/cron-jobs.json` with in-memory caching.

#### Scenario: Optional editableByAnyone flag

- **WHEN** a cron job row is persisted
- **THEN** it MAY carry `editableByAnyone: true` (optional boolean; absent means `false`)
- **AND** the field is serialized only when `true`, so jobs without it stay byte-identical on disk
- **AND** the graceful loader accepts rows with or without the field (no migration, no quarantine)

## ADDED Requirements

### Requirement: Universal Redacted Visibility

`list_scheduled_messages` and `get_scheduled_message` SHALL surface ALL channel-targeted jobs to every caller, regardless of role or ownership. For each job, the caller either has full view (admin, job owner, or the job is `editableByAnyone`) or receives a REDACTED projection limited to identity/schedule metadata: `id`, `name`, `channel`, human-readable schedule, `cronExpression`, `enabled`, `oneShot`, `createdBy`, `systemActor`, `plugin`, `editableByAnyone`, `lastRunAt`, `lastRunStatus`, plus `redacted: true`. Redacted projections SHALL NOT include `prompt`, `skipConditions`, `requiredTools`, `attachedTopics`, `submitResponseMode`, `attentionLevel`, or run details. Jobs targeting a DM (channel id starting with `D`) and channelless user-created jobs SHALL remain visible only to their owner and admins — for other callers they do not exist on ANY read path (list omits them; get returns not-found, never redacted metadata). The `includeOtherUsers` argument is removed.

#### Scenario: DM-targeted jobs stay private

- **WHEN** a non-admin calls `list_scheduled_messages` and another user has a job targeting a DM (or a channelless user-created job)
- **THEN** that job does not appear in the result at all (not even redacted)
- **AND** the job's owner and admins still see it in full

#### Scenario: get_scheduled_message on a private-target job returns not-found

- **WHEN** a non-admin calls `get_scheduled_message` with the id of another user's DM-targeted (or channelless user-created) job
- **THEN** the tool returns a not-found error — never redacted metadata (existence itself is private)

#### Scenario: Non-admin sees another user's job, redacted

- **WHEN** a non-admin calls `list_scheduled_messages` and another user's job targets a channel in scope
- **THEN** the row appears with its `id`, `name`, `channel`, schedule, and `createdBy`
- **AND** carries `redacted: true` with no `prompt` or other content fields

#### Scenario: Own, admin-viewed, and shared jobs stay full

- **WHEN** the caller is the job's owner, an admin, or the job has `editableByAnyone: true`
- **THEN** the row carries the full field set (today's shape), with no `redacted` flag

#### Scenario: get_scheduled_message on a non-viewable job returns the redacted summary

- **WHEN** a non-admin calls `get_scheduled_message` with the id of another user's non-shared job
- **THEN** the tool returns the same redacted projection (not an error)
- **AND** the result names the owner and directs Claude to the owner or an admin for content or changes

#### Scenario: Channel disambiguation across owners

- **WHEN** two jobs owned by different users target the same channel and a non-admin asks about "the automation" in that channel
- **THEN** `list_scheduled_messages` filtered by that channel returns BOTH rows (one full, one redacted)
- **AND** Claude can distinguish them by `name`, schedule, and `createdBy`

### Requirement: Editable-By-Anyone Shared Jobs

A cron job with `editableByAnyone: true` SHALL be fully visible to every caller (`list_scheduled_messages` full rows, `get_scheduled_message`, `get_scheduled_message_runs`) and editable by every caller (`update_scheduled_message` — content fields AND `enabled` — and `run_scheduled_message_now`). Deletion (`cancel_scheduled_message`) SHALL remain restricted to the job's owner and admins regardless of the flag — the recoverable off-switch for shared jobs is disabling. The flag itself SHALL be settable at creation and toggleable ONLY by the job's owner or an admin. Plugin-managed jobs SHALL reject the flag.

#### Scenario: Create a shared job

- **WHEN** a user creates a scheduled message with `editableByAnyone: true`
- **THEN** the persisted job carries the flag
- **AND** any other user can subsequently update, disable/re-enable, or run it

#### Scenario: Non-owner edits and disables a shared job

- **WHEN** a non-admin who does not own a job with `editableByAnyone: true` calls `update_scheduled_message` on it (including `enabled: false`)
- **THEN** the update is applied

#### Scenario: Non-owner cannot delete a shared job

- **WHEN** a non-admin who does not own a shared job calls `cancel_scheduled_message` on it
- **THEN** the deletion is rejected, naming the owner and suggesting disable (`enabled: false`) as the available off-switch

#### Scenario: Non-owner cannot toggle the flag

- **WHEN** a non-admin who does not own a shared job passes `editableByAnyone` (true or false) to `update_scheduled_message`
- **THEN** the flag change is rejected with an error naming the owner/admin requirement
- **AND** owner and admin callers CAN set or clear it

#### Scenario: Plugin-managed jobs reject the flag

- **WHEN** `editableByAnyone` is passed for a plugin-managed job
- **THEN** the tool returns an error (plugin config owns those jobs; they are already visible to everyone)

#### Scenario: Runs visibility follows the flag

- **WHEN** any user calls `get_scheduled_message_runs` on an `editableByAnyone` job
- **THEN** the run history is returned

#### Scenario: Home Tab shared-flag toggle

- **WHEN** the Home Tab renders a scheduled-message row the viewer owns (or the viewer is an admin)
- **THEN** the row offers a toggle button that flips `editableByAnyone`
- **AND** the action handler enforces the owner/admin check server-side (not just by button visibility)

### Requirement: Grouped Home Tab Scheduled-Messages Sections

The Home Tab Scheduled Messages section SHALL list all jobs visible to the viewer under the tool-layer visibility rules, partitioned into up to three viewer-relative subsections rendered in order and omitted when empty: **Shared** (`editableByAnyone` jobs, labeled "Shared"), **Yours** (viewer-owned non-shared jobs), and other users' non-shared jobs (labeled "Non-Accessible" for non-admins, "Other users'" for admins). Non-admin rows in the third subsection SHALL use the redacted projection (name, channel, schedule, owner — no Edit button); other users' DM-targeted and channelless jobs SHALL NOT appear at all. The admin-only plugin-managed subsection is unchanged. All headers/labels are `t()`-sourced with en + fr parity.

#### Scenario: Non-admin sees three groups

- **WHEN** a non-admin opens the Home Tab and the registry holds a shared job, their own job, and another user's channel-targeted job
- **THEN** the section shows "Shared" (with Edit), "Yours" (with Edit), and "Non-Accessible" (redacted row, no Edit) headers in that order

#### Scenario: Empty groups are omitted

- **WHEN** no jobs fall in a subsection
- **THEN** that subsection's header does not render

#### Scenario: Admin third group keeps controls

- **WHEN** an admin views another user's non-shared job
- **THEN** it renders under the "Other users'" header with full row content and controls

### Requirement: update_scheduled_message Accepts an Enabled Toggle

`update_scheduled_message` SHALL accept an optional `enabled: boolean`, applied under the same edit gate as content fields (owner, admin, or shared job). Omitting the field leaves the persisted value unchanged. Plugin-managed jobs keep their existing rejection (pause/resume stays on the Home Tab).

#### Scenario: Disable via chat

- **WHEN** an authorized caller passes `enabled: false` for a job
- **THEN** the job stops firing but remains in the registry with all its content intact
- **AND** `enabled: true` later resumes it unchanged

### Requirement: Cancellation Names Its Target and Turn-Off Prefers Disable

`cancel_scheduled_message` SHALL return the cancelled job's `name`, `channel`, human-readable schedule, and owner alongside the confirmation. Tool descriptions SHALL instruct Claude to (a) confirm the target by job NAME and owner — never by an ambiguous reference like "this automation" — whenever more than one job targets the channel in scope, and (b) satisfy "turn off" / "stop" / "pause" wording with `update_scheduled_message` `enabled: false` (recoverable), reserving `cancel_scheduled_message` for explicit delete/cancel/remove wording.

#### Scenario: Cancel result echoes identity

- **WHEN** a job is cancelled
- **THEN** the result includes `id`, `name`, `channel`, schedule, and `createdBy`
- **AND** Claude's confirmation to the user can name exactly what was cancelled

#### Scenario: Ambiguous cancel request in a multi-job channel

- **WHEN** a user asks to turn off "this automation" in a channel that hosts more than one scheduled job
- **THEN** Claude (per the tool description) lists the candidates by name/owner/schedule and confirms which one before acting

#### Scenario: "Turn off" disables instead of deleting

- **WHEN** a user says "turn this off" / "stop this" without explicit delete wording
- **THEN** Claude (per the tool descriptions) disables the job via `update_scheduled_message` `enabled: false` rather than cancelling it
- **AND** tells the user the job is paused and recoverable

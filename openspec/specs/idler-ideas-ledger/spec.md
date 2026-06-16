# idler-ideas-ledger Specification

## Purpose
TBD - created by archiving change add-idler-plugin. Update Purpose after archive.
## Requirements
### Requirement: Self-describing work-unit ledger

The system SHALL persist the idler's per-unit work-state in the core memory faculty rather than a bespoke `ideas.json` file. Each work unit SHALL correspond to one core memory entry (keyed by the unit's stable source-entity `id`) whose core fields hold the durable knowledge — `what` and the `references` recipes — while the idler's execution bookkeeping lives in that entry's `plugins.idler` namespace slice: an `open` boolean (the only status), a numeric `priority`, a `kind`, free-text `whereWeAre`, and a `cursorsByRefId` map (`Record<string, string>` keyed by reference id) holding the per-reference idempotency cursors. There SHALL be no status enum beyond `open`/`done` and no sticky focus pointer; lifecycle nuance lives in free text. The idler SHALL read and merge its slice through `sdk.memory.data(schema)`, validating it with its own zod schema.

#### Scenario: Work-state shape in the memory namespace

- **WHEN** an idler work unit is persisted
- **THEN** its durable `what` and `references` recipes live on the core memory entry
- **AND** its `open`, `priority`, `kind`, `whereWeAre`, and `cursorsByRefId` map live under `plugins.idler`
- **AND** there is no status enum beyond `open`/`done` and no `activeId` pointer

#### Scenario: Malformed slice reads as default

- **GIVEN** an entry whose `plugins.idler` slice fails the idler's schema
- **WHEN** the idler loads its work-state
- **THEN** it logs and treats that slice as absent rather than throwing or wiping the entry

#### Scenario: Completed unit drops out of selection

- **GIVEN** an entry whose `plugins.idler.open` is set to false (done, with a one-line reason in free text)
- **WHEN** the work task selects a unit
- **THEN** the done unit is excluded from selection

### Requirement: Growing self-describing references

Each memory entry the idler works SHALL carry a `references` array on its core fields that grows as the unit spans new surfaces (e.g. an Asana task, then a GitHub PR, then a Slack thread). Each reference SHALL self-describe `howToRead` (how to retrieve its current status) and `howToComment` (how to post back) as durable core knowledge; the per-reference idempotency cursor SHALL live in the idler's `plugins.idler.cursorsByRefId` map, keyed by reference id (it is execution state, not durable knowledge). Clack SHALL append references to the core entry as work progresses.

#### Scenario: Reference appended when a PR is opened

- **GIVEN** a memory entry sourced from an Asana task with one reference
- **WHEN** Clack opens a PR for it
- **THEN** a `github-pr` reference is appended to the core entry carrying its own `howToRead` and `howToComment`
- **AND** its cursor is recorded in `plugins.idler.cursorsByRefId` keyed by the new reference's id
- **AND** the original Asana reference is retained

#### Scenario: Comment destination is contextual

- **GIVEN** an entry with both an Asana reference and a GitHub PR reference
- **WHEN** Clack needs missing requirements to proceed
- **THEN** it comments on the Asana reference
- **AND** when it has review feedback, it comments on the PR reference

### Requirement: Sync-recomputed priority

The sync task SHALL recompute each open unit's `priority` on every run from three contributions: the kind of pending work (where `continue > triage > implement > review` in weight), fresh-input signals detected by re-running each reference's `howToRead` (a human reply or a new comment past the `cursor` raises priority), and blocked-now signals (waiting on a human with no activity past the `cursor` lowers priority). Clack SHALL be able to override the computed score via a reprioritize tool.

#### Scenario: Blocked unit sinks

- **GIVEN** a unit awaiting a human reply with no new activity past its cursor
- **WHEN** sync recomputes priority
- **THEN** the unit's priority is lowered so the work task will not select it

#### Scenario: Fresh reply resurfaces a blocked unit

- **GIVEN** a previously blocked unit
- **WHEN** sync re-runs its reference `howToRead` and detects a new reply past the cursor
- **THEN** the unit's priority is raised so the next work fire selects it

#### Scenario: Clack reprioritization overrides the computed score

- **WHEN** Clack calls the reprioritize tool on a unit
- **THEN** the unit's effective priority reflects Clack's override

### Requirement: Work-task authority and pre-act refresh

The work task SHALL be the sole writer of a unit while it is actively advancing it — its `whereWeAre`, `nextSteps`, and `references` for that unit. The sync task SHALL refresh `priority`/`whereWeAre` for all OTHER open units but SHALL NOT overwrite the unit the work task is advancing. Before committing to a step on its selected unit, the work task SHALL re-read that unit's references (re-run their `howToRead`) so the decision uses current context rather than the last sync snapshot. Each task is independently serialized by the scheduler's running-job guard.

#### Scenario: Sync does not clobber the in-flight unit

- **GIVEN** the work task is advancing a unit
- **WHEN** the sync task runs concurrently
- **THEN** sync refreshes other open units but leaves the in-flight unit's `whereWeAre`/`nextSteps`/`references` untouched

#### Scenario: Work re-reads before acting

- **GIVEN** the work task selects the top-priority unit from a possibly stale snapshot
- **WHEN** it picks the unit
- **THEN** it re-reads the unit's references before committing to a step
- **AND** if the refreshed context shows the unit is no longer workable, it does nothing this tick

### Requirement: Triage verdict against the codebase

Before implementing a candidate, the system SHALL compare it against the actual codebase (via code search, file reads, and history) and reach exactly one verdict: actionable, needs-info, or already-done. A needs-info verdict SHALL comment on the source requesting the missing guidance. An already-done verdict SHALL comment with concrete proof — a file:line, commit SHA, or PR reference — and close the unit.

#### Scenario: Needs-info comments and waits

- **GIVEN** a candidate lacks enough guidance to act on
- **WHEN** triage runs
- **THEN** Clack comments on the source asking for the specific missing information
- **AND** the reference cursor advances past that comment so it is not re-asked
- **AND** the unit remains open at a lowered priority, re-triaged only when the source has new activity past the cursor

#### Scenario: Already-done comments with proof

- **GIVEN** triage finds the candidate is already implemented in the codebase
- **WHEN** triage runs
- **THEN** Clack comments with concrete evidence (file:line, commit, or PR)
- **AND** the unit is marked done

#### Scenario: Actionable advances to implementation

- **GIVEN** triage finds the candidate actionable
- **WHEN** triage runs
- **THEN** the unit stays open and eligible for the implement kind on a later fire

### Requirement: Stable source-keyed unit identity and dedup

A work unit's identity SHALL be a stable key derived from the underlying source entity (e.g. a Sentry issue short-id, an Asana task gid, a GitHub PR number), NOT the triggering message timestamp. When a source re-emits the same entity (a Sentry issue re-alerting, a tracker task re-surfacing), the system SHALL update the existing unit rather than create a duplicate.

#### Scenario: Repeated Sentry alert maps to one unit

- **GIVEN** an open unit keyed by Sentry issue `PROJ-1Q2W`
- **WHEN** the same Sentry issue re-alerts in the channel
- **THEN** no second unit is created
- **AND** the existing unit's reference cursor/`whereWeAre` is updated to reflect the new activity

#### Scenario: Distinct issues are distinct units

- **GIVEN** two different Sentry issues alert in the channel
- **WHEN** sync discovers them
- **THEN** two distinct units are created, each keyed by its own issue id

#### Scenario: Re-activated done unit re-opens

- **GIVEN** a unit previously marked `done` (e.g. triaged already-done, or its PR merged)
- **WHEN** the same source entity shows new activity past the cursor (a Sentry regression, a re-opened/re-assigned task)
- **THEN** the existing unit is re-opened (`open` set true) rather than a duplicate created

### Requirement: Full-auto approval, no human gate

A discovered candidate SHALL become eligible for work without a human approval click — eligibility is determined by the admin fetch-instruction criteria evaluated during sync/triage. The morning summary, not a pre-work gate, is the human checkpoint.

#### Scenario: Candidate becomes eligible by criteria

- **GIVEN** a discovered candidate that satisfies the fetch-instruction eligibility criteria
- **WHEN** it passes triage as actionable
- **THEN** it becomes eligible for the implement kind without any human approval action

#### Scenario: Ineligible candidate is not worked

- **GIVEN** a discovered candidate that does not satisfy the eligibility criteria (e.g. non-allowlisted repo, excluded by fetch rules)
- **WHEN** the work task evaluates it
- **THEN** it is not implemented or continued

### Requirement: Per-reference comment idempotency

The system SHALL avoid repeating a comment on a reference it has already commented on, using the reference's `cursor` and the unit's free-text state. A blocked unit SHALL be re-commented or re-triaged only when its source has changed past the recorded cursor.

#### Scenario: No duplicate needs-info comment

- **GIVEN** a unit already commented with a needs-info question and no new source activity past its cursor
- **WHEN** sync re-evaluates it
- **THEN** no additional comment is posted

#### Scenario: New PR comments processed once

- **GIVEN** a PR reference with a recorded cursor
- **WHEN** new comments arrive past the cursor and are processed
- **THEN** the cursor advances so the same comments are not processed again


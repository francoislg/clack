## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Top-N idea retrieval

**Reason**: Top-N selection moves to the core memory surface — the work task lists the highest-priority entries that carry a `plugins.idler` slice via `sdk.memory.data(...)`, replacing the idler-local `list_top_ideas` over `ideas.json`. The bounded-context behavior is preserved by the idler reading and sorting its slices in memory; it is no longer a ledger-specific requirement.
**Migration**: The idler's work fire reads candidate entries through `sdk.memory` (entries with an `idler` slice), sorts by `plugins.idler.priority`, and takes the top N. See the `idler-plugin` requirement "Work-state in the core memory namespace".

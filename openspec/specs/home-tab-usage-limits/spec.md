# home-tab-usage-limits Specification

## Purpose
TBD - created by archiving change add-home-tab-usage-limits. Update Purpose after archive.
## Requirements
### Requirement: Capture rate-limit snapshots from Claude runs

The system SHALL read the `rate_limit_info` payload of every `rate_limit_event` streamed by the Agent SDK during a Claude run and capture the full snapshot (`status`, `utilization`, `resetsAt`, `rateLimitType`, and overage fields), not only the `rejected` case. Existing hard-limit rejection handling SHALL be unchanged.

#### Scenario: An allowed event carries utilization

- **WHEN** a run streams a `rate_limit_event` with `status: "allowed"`, `rateLimitType: "five_hour"`, and a `utilization` value
- **THEN** the system captures that utilization and reset time for the `five_hour` window
- **AND** does not raise or surface a platform-limit rejection

#### Scenario: A rejected event still triggers limit handling

- **WHEN** a run streams a `rate_limit_event` with `status: "rejected"`
- **THEN** the existing platform usage-limit handling still fires
- **AND** the snapshot for that window is also captured

### Requirement: Persist the latest snapshot per window

The system SHALL persist the most recently observed snapshot for each `rateLimitType` to durable state, each entry stamped with the time it was observed. A snapshot for one window MUST NOT overwrite the stored snapshot of a different window. The store SHALL be read through a permissive (graceful) schema that returns an empty result — never throws — on a missing or malformed file.

#### Scenario: Hourly and weekly readings coexist

- **WHEN** a run observes a `five_hour` snapshot and a later run observes a `seven_day` snapshot
- **THEN** both windows' latest snapshots are retained in state
- **AND** each carries its own observation timestamp

#### Scenario: A newer reading for the same window replaces the older one

- **WHEN** a later run observes a fresh snapshot for a window that already has a stored snapshot
- **THEN** the stored entry for that window is replaced by the newer snapshot with an updated observation timestamp
- **AND** other windows' entries are left untouched

#### Scenario: Malformed state file

- **WHEN** the persisted usage-limits file is missing or fails schema validation
- **THEN** the reader logs and returns an empty snapshot set
- **AND** no error propagates to the Home Tab or the run

#### Scenario: Entry missing its observation timestamp

- **WHEN** a stored window entry is otherwise valid but lacks its `observedAt` timestamp
- **THEN** the reader retains the entry without throwing
- **AND** the panel renders that window's reset time but omits the "as of" staleness note

#### Scenario: One write per run

- **WHEN** a single run streams multiple `rate_limit_event` messages
- **THEN** the system persists the final observed snapshot once for that run rather than writing on every event

### Requirement: Admin-only Home Tab usage panel

The Home Tab SHALL render a usage-limits section visible only to admin-or-higher users. The section SHALL show one row per known window (hourly, weekly, and any per-model weekly or overage windows present in state), each row displaying the percent of budget used and the window's reset time in the viewer's locale. Non-admin users SHALL NOT see the section.

#### Scenario: Admin views populated panel

- **WHEN** an admin opens the Home Tab and snapshots exist for the hourly and weekly windows
- **THEN** the panel shows a row for each with its percent used and reset time
- **AND** each row indicates how recently the reading was observed

#### Scenario: Non-admin does not see the panel

- **WHEN** a member or dev opens the Home Tab
- **THEN** the usage-limits section is absent from their view

#### Scenario: Utilization is clamped and rendered as a percent

- **WHEN** a stored window has a `utilization` fraction
- **THEN** the row renders it as a percent bounded to 0–100%

#### Scenario: Unknown window type renders with a fallback label

- **WHEN** a stored window carries a `rateLimitType` the UI does not have a dedicated label for (e.g. a value introduced by a future SDK version)
- **THEN** the panel still renders a row for it using a generic fallback label
- **AND** no error is shown

### Requirement: Empty and stale states

When no snapshot has been observed (fresh boot, or auth that emits no rate-limit events), the panel SHALL render an explicit empty state for admins rather than being hidden. When a reading's `observedAt` is older than the staleness threshold — a fixed 30 minutes — the row SHALL indicate the reading may be outdated. Reset times SHALL be presented as absolute times so they remain meaningful regardless of reading age.

#### Scenario: No data yet

- **WHEN** an admin opens the Home Tab and no rate-limit snapshot has ever been observed
- **THEN** the section is present and shows a neutral "no usage data yet" state
- **AND** no error is shown

#### Scenario: Stale reading

- **WHEN** a window's most recent observation is older than 30 minutes
- **THEN** the row notes that the reading may be outdated
- **AND** still shows the window's reset time

### Requirement: Localized strings

All user-facing text in the usage-limits section SHALL resolve through the core `t()` localization layer, with keys defined in both the English and French dictionaries and satisfying key/placeholder parity.

#### Scenario: French rendering

- **WHEN** the workspace language is French
- **THEN** the section header, window labels, reset/staleness phrasing, and empty state render in French


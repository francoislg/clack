# cron-messages Delta — add-trivia-off-days

## ADDED Requirements

### Requirement: Cron Job Skip Dates

A `CronJob` MAY optionally carry a `skipDates: SkipDate[]` field. When set, the scheduler SHALL deterministically skip the run on any matching date — no Claude session is opened, and no tokens are spent.

```ts
interface SkipDate {
  /** Either YYYY-MM-DD (exact date) or MM-DD (recurring annually). Interpreted in the job's timezone. */
  date: string;
  /** Human-readable label used in logs. Required, non-empty. */
  label: string;
}
```

The matcher SHALL format the comparison time in `job.timezone` as both `YYYY-MM-DD` and `MM-DD` and SHALL match an entry whose `date` equals either representation. First match wins.

A skipped fire SHALL:
- Update `lastRunAt` to the matched run time (preventing same-minute double-fire).
- Append a `runs[]` entry with `status: "skipped"` (no `responseTs`).
- Log an `info` line identifying the job and the matched label (e.g. `Cron job <id> skipped by skipDates (Christmas)`).
- Honor `oneShot` deletion semantics the same as a `skipConditions` skip — a skipped off-day still counts as the one-shot's chance to fire.
- NOT invoke `processMessage` (no Claude session is created).

`skipDates` SHALL be evaluated BEFORE `skipConditions`. When both are set and a `skipDates` entry matches, the `skipConditions` path is never reached.

#### Scenario: skipDates field is optional

- **GIVEN** a `CronJob` with no `skipDates` field
- **WHEN** the scheduler tick fires it
- **THEN** the run proceeds normally (matching pre-change behavior)

#### Scenario: Exact-date match skips without Claude

- **GIVEN** a `CronJob` with `timezone: "America/Montreal"` and `skipDates: [{ date: "2026-12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires the job at `2026-12-25T09:00 America/Montreal`
- **THEN** `processMessage` is NOT called
- **AND** the job's `lastRunAt` is set to the fire time
- **AND** a `runs[]` entry is appended with `status: "skipped"` and no `responseTs`
- **AND** an info log mentions the matched label `"Christmas"`

#### Scenario: Recurring MM-DD match skips

- **GIVEN** a `CronJob` with `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires it on any year's December 25 in the job's timezone
- **THEN** the run is skipped (same bookkeeping as the exact-date scenario)

#### Scenario: skipDates evaluated in job timezone

- **GIVEN** a `CronJob` with `timezone: "Australia/Sydney"` and `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires it at a moment that is `2026-12-24T20:00Z` (which is `2026-12-25T07:00 Sydney`)
- **THEN** the run is skipped — the date check uses the Sydney calendar

#### Scenario: Non-matching date fires normally

- **GIVEN** a `CronJob` with `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires it on any date other than December 25 in `job.timezone`
- **THEN** the run proceeds normally — `processMessage` is called, the standard outcome flow applies

#### Scenario: skipDates takes precedence over skipConditions

- **GIVEN** a `CronJob` with both `skipDates: [{ date: "12-25", label: "Christmas" }]` and `skipConditions: "Skip if no games yesterday."`
- **WHEN** the scheduler fires it on December 25 in `job.timezone`
- **THEN** the run is skipped via the `skipDates` gate
- **AND** no Claude session is opened (the `skipConditions` evaluation never runs)

#### Scenario: One-shot job skipped on an off-day is still deleted

- **GIVEN** a `CronJob` with `oneShot: true` and `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires it on December 25
- **THEN** the run is recorded as `status: "skipped"`
- **AND** the job is deleted from storage (mirroring the existing one-shot-skipped behavior for `skipConditions`)

#### Scenario: Replay respects skipDates against the replay date

- **GIVEN** a `CronJob` with `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** `run_scheduled_message_now` is invoked with `asOf: "2026-12-25T09:00 America/Montreal"`
- **THEN** the replay is skipped — the date check uses `asOf`, not the current time
- **AND** the appended `runs[]` entry records `replayOf` as documented for skipped replays in the existing scheduled-messages spec

#### Scenario: Invalid skipDates entries are tolerated at runtime

- **GIVEN** a `CronJob` whose `skipDates` somehow contains an entry with a malformed `date` (e.g. surviving a hand-edit to the JSON file)
- **WHEN** the scheduler evaluates the gate
- **THEN** the malformed entry does NOT match any date (the comparison naturally fails)
- **AND** the run proceeds based on the remaining entries' matching status — no crash, no hard error

### Requirement: SkipDates Serialization

`CronJob` serialization (load/save of `cron-jobs.json`) SHALL preserve the `skipDates` field round-trip when present, and SHALL omit it from the serialized form when absent or empty. Pre-existing jobs without `skipDates` SHALL load normally (field defaults to absent).

#### Scenario: skipDates round-trips through persistence

- **GIVEN** a `CronJob` with `skipDates: [{ date: "12-25", label: "Christmas" }]` saved to `cron-jobs.json`
- **WHEN** the scheduler reloads jobs from disk
- **THEN** the reloaded job has the same `skipDates` array

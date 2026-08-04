# trivia-reveal-reminders Specification

## Purpose

Enable trivia players to opt into reminder DMs before reveal time, with per-game configuration of which games send reminders.

## Requirements

### Requirement: Reveal-Reminder Preference

The trivia plugin SHALL register a per-user `revealReminders` boolean preference (default `false`, opt-in) through the plugin preferences mechanism, so it renders in the Personal Preferences modal with a localized label. The plugin SHALL read it via `sdk.preferences.get(userId, schema)` when deciding whom to remind.

#### Scenario: Preference defaults to off

- **WHEN** a user has never toggled the reveal-reminder preference
- **THEN** `sdk.preferences.get` returns no enabled value for that user
- **AND** the user is not sent reveal reminders

#### Scenario: User opts in

- **WHEN** a user enables the reveal-reminder toggle in the Personal Preferences modal
- **THEN** the value is persisted to that user's trivia preference slice
- **AND** the user becomes eligible for reveal reminders

### Requirement: Per-Game Reminder Enablement

`TriviaGame` SHALL carry an optional `remindMissedPlayers` boolean (default `false`). Reveal reminders SHALL be emitted for a game only when this flag is `true`. The flag is settable via `upsert_game` (omit-to-keep, null-to-clear). When `false` or unset, the game produces no reminder cron and behaves exactly as before this feature.

#### Scenario: Flag off produces no reminder cron

- **WHEN** a game has `remindMissedPlayers` unset or `false`
- **THEN** `buildGameSpecs` emits no `<game>:reminder` spec for it
- **AND** the game's other cron specs are unchanged

#### Scenario: Flag on enables reminders

- **WHEN** a game has `remindMissedPlayers` set to `true`
- **AND** its reveal cron has a derivable one-hour-earlier time
- **THEN** `buildGameSpecs` emits a `<game>:reminder` spec

### Requirement: Derived Reminder Schedule

The reminder cron SHALL be derived from the game's `revealCron` by shifting its fire time back one hour, honoring the game's timezone. Derivation SHALL support the common single-integer hour field (e.g. hour `17` → `16`). When the hour field is not a plain integer, or shifting would cross midnight (hour `0`), derivation SHALL return no reminder cron and log a warning rather than emit an incorrect schedule. The reminder cron SHALL NOT be caught up on boot.

#### Scenario: Afternoon reveal derives a one-hour-earlier reminder

- **WHEN** `revealCron` is `0 17 * * 1-5`
- **THEN** the derived reminder cron is `0 16 * * 1-5`

#### Scenario: Non-derivable reveal cron is skipped

- **WHEN** `revealCron` has a non-integer hour field or an hour of `0`
- **THEN** no reminder cron is derived
- **AND** a warning is logged
- **AND** the game still schedules its other specs normally

#### Scenario: Missed reminder is not backfilled

- **WHEN** the process was down when a reminder slot passed
- **THEN** boot catch-up does not fire the reminder
- **AND** no late reminder DM is sent

### Requirement: Missed-Player Audience Computation

The reminder SHALL DM only users who satisfy all of: (a) are known trivia players for the game (present in the game's user set), (b) have not submitted an answer to any question in the current round's batch, and (c) have the `revealReminders` preference enabled. The current round's batch SHALL be the earliest pending batch (questions with `postedAt` set and `processedAt` unset). Recipient selection SHALL be deterministic and owned by the tool, never chosen by Claude.

#### Scenario: Opted-in non-answerer is reminded

- **WHEN** a game player has enabled reveal reminders
- **AND** has not answered any question in the current round
- **THEN** they receive a reminder DM

#### Scenario: Player who already answered is not reminded

- **WHEN** a game player has answered at least one question in the current round
- **THEN** they receive no reminder DM, regardless of preference

#### Scenario: Opted-out player is not reminded

- **WHEN** a game player has not enabled reveal reminders
- **THEN** they receive no reminder DM even if they have not answered

#### Scenario: No eligible recipients is a no-op

- **WHEN** no player is both opted-in and a non-answerer
- **THEN** no DM is sent and the reminder run completes without posting anything

### Requirement: Reminder Delivery Tool

The trivia plugin SHALL expose a cron-only `remind_unplayed` tool that computes the audience per the audience rules and DMs each recipient the reminder text via `sdk.dmUser`. The tool SHALL accept the reminder message text (composed by Claude in the workspace language) and SHALL return the number of recipients reminded. The tool SHALL be included in the reminder spec's `requiredTools`; the reminder cron prompt SHALL instruct Claude to compose a short, friendly, localized reminder and call the tool without naming or mentioning specific users.

#### Scenario: Tool sends to computed audience

- **WHEN** the reminder cron fires and Claude calls `remind_unplayed` with a message
- **THEN** the tool DMs the message to each eligible recipient via `sdk.dmUser`
- **AND** returns the count of recipients reminded

#### Scenario: Delivery failure to one recipient does not abort the rest

- **WHEN** DMing one recipient fails
- **THEN** the remaining recipients are still DMed
- **AND** the failure is logged

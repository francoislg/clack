## Why

Trivia games today fire on every cron tick that matches their schedule. There's no first-class way to say "skip this on Christmas, Canada Day, and our company holidays." The closest existing tool is the generic `skipConditions` free-form field, which:

1. Costs a full Claude session per fire to evaluate prose,
2. Is non-deterministic — Claude could misread a date list and post anyway, or skip a normal day,
3. Has to be set on every job individually, not at the trivia-plugin level.

For a "post a trivia question Mon–Fri except statutory holidays" workflow, operators want a structured, deterministic, plugin-level holiday list. Today they have nothing.

## What Changes

**User-facing (trivia config):**

- Add optional `trivia.offDays: OffDay[]` to `data/config.json`. Single list shared by **all** games declared in `trivia.games[]` — there is no per-game override in v1.
- Each entry is `{ date: string, label: string }`. The `date` field accepts either:
  - `YYYY-MM-DD` — exact date (e.g. `"2026-04-03"` for Good Friday 2026)
  - `MM-DD` — recurring annually (e.g. `"12-25"` for every Christmas)
- The `label` is required (used for logging and Home Tab display).
- Invalid entries (unparseable `date`, missing `label`) are dropped with a logged warning at config-load time — matches existing `trivia.games[]` parser behavior.

**Cron-layer (generic mechanism, only exposed via trivia in v1):**

- Add optional `skipDates?: SkipDate[]` field to `CronJob` and `CronJobSpec`. Same shape as `OffDay`.
- Scheduler evaluates `skipDates` **before** opening a Claude session, inside `executeJob`. If today (in `job.timezone`) matches any `skipDates` entry, the run records `status: "skipped"`, bumps `lastRunAt`, appends a `runs[]` entry, and never invokes Claude.
- `skipDates` composes with the existing `skipConditions`: structured dates checked first (free, deterministic), then prose conditions (Claude-evaluated) if not already skipped.
- `run_scheduled_message_now` (replay): the date check uses the replay's `asOf` date — replaying a past off-day still skips, replaying a non-off-day still fires.

**Wiring:**

- `buildGameSpecs(games, seasonsEnabled, offDays?)` gains an `offDays` parameter. The trivia plugin reads `config.trivia.offDays` once at reconcile time and propagates it into every emitted spec's `skipDates`. All cron jobs for all games in `trivia.games[]` share the same list.
- Updating `config.trivia.offDays` and reloading config triggers reconcile; each plugin-managed cron job's `skipDates` is updated in place.

**Out of scope (v2 candidates, called out so future readers don't think they're forgotten):**

- Per-game offDays overrides.
- Named/external holiday calendars (`ca-stat-holidays`, etc.).
- Half-day or time-windowed skips (cron expressions already handle time-of-day).
- Home Tab UI for editing the list (admins edit `config.trivia.offDays` directly for now, same as `trivia.games[]`).

## Capabilities

### Modified Capabilities

- `trivia-managed-schedules`: gains `config.trivia.offDays?: OffDay[]` schema + parser validation, and the rule that `buildGameSpecs` propagates the list into every reconciled spec's `skipDates`.
- `cron-messages`: gains the optional `skipDates` field on `CronJob` and the deterministic date-skip gate in `executeJob` (evaluated in `job.timezone`, recorded as `status: "skipped"`, composing with `skipConditions`).

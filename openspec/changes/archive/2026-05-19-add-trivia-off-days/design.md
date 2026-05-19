# Design — add-trivia-off-days

## The two-layer split

The user-facing surface is trivia-only (`config.trivia.offDays`), but the actual skip mechanism lives in the cron scheduler. This is deliberate:

- The trivia plugin owns *what dates to skip* (config schema, parsing, reconcile wiring).
- The cron scheduler owns *how to skip on a date* (the deterministic gate inside `executeJob`).

Why not bake the date check into the trivia plugin? Because there is no plugin hook between the cron scheduler matching a tick and opening a Claude session. The scheduler goes straight from `matchesCron` to `processMessage`. Adding a "should we fire this job" callback for plugins to register is a strictly bigger change than adding one optional structured field to the cron schema.

Why not just use `skipConditions`? Two reasons:

1. **Cost.** Trivia jobs fire ~365×/year per game. A `skipConditions` evaluation opens a full Claude session even when the answer is "skip." Off-days hit ~10–15 days/year — those should be free.
2. **Determinism.** Claude evaluating "skip if today is one of: 2026-12-25, 2026-01-01" *could* get it wrong and post on Christmas morning. A date comparison cannot. For high-stakes "absolutely do not post" rules, prose is the wrong substrate.

## Where the gate sits

`cronScheduler.ts:executeJob` currently looks roughly like:

```
runningJobs.add(job.id)
try {
  outcome = executeDynamicJob(job, client, deps, asOf)  // opens Claude session
  if (outcome.skipped) updateJobRunStatus("skipped")
  else updateJobRunStatus("success", outcome.responseTs)
  if (job.oneShot) deleteJob(job.id)
} catch (error) { ... }
finally { runningJobs.delete(job.id) }
```

The new gate goes immediately after `runningJobs.add` and before `executeDynamicJob`:

```
runningJobs.add(job.id)
try {
  if (matchesSkipDate(job.skipDates, asOf ?? new Date(), job.timezone)) {
    await updateJobRunStatus("skipped", undefined, asOf?.toISOString())
    logger.info(`Cron job ${job.id} skipped by skipDates (${matchedEntry.label})`)
    if (job.oneShot) await deleteJob(job.id)
    return
  }
  outcome = executeDynamicJob(...)
  ...
}
```

Reasons for this placement:

- After `runningJobs.add` so concurrent ticks don't double-fire even on a skip-day.
- Before the Claude session so we don't pay for it.
- `updateJobRunStatus` is called identically to the `skipConditions` skip path — same `runs[]` shape, same `lastRunAt` bump.
- `oneShot` deletion still happens — a skipped off-day still counts as the one-shot's chance to fire, consistent with the existing `skipConditions` one-shot rule (`cron-messages` spec, "One-shot job skipped" scenario).
- Replay path is the same code, with `asOf ?? new Date()` already handling the replay date.

## Replay semantics

`run_scheduled_message_now({asOf: "2026-12-25T09:00Z"})` will skip if Dec 25 is in `skipDates`. The user can already get past it by either:
1. Temporarily editing `config.trivia.offDays`, or
2. Replaying with a different `asOf` that's not an off-day.

We don't add a "bypass off-days on manual replay" flag in v1. Rationale: the date IS the rule, and the existing replay docs already say replays mirror the scheduled behavior for date-based logic. If this turns out to be annoying in practice, add a flag later.

## Date format and parsing

Mixed strings, parsed by length:

| String | Match rule |
|---|---|
| `YYYY-MM-DD` (10 chars) | exact calendar date |
| `MM-DD` (5 chars) | any year, that month/day |
| anything else | parser warns, entry dropped |

Both formats interpreted in `job.timezone`. The match function:

```ts
function matchesSkipDate(
  entries: SkipDate[] | undefined,
  now: Date,
  timezone: string,
): SkipDate | null {
  if (!entries || entries.length === 0) return null;
  // Format `now` in `timezone` as `YYYY-MM-DD` and `MM-DD`, compare.
  const ymd = formatInTimezone(now, timezone, "yyyy-MM-dd");
  const md = formatInTimezone(now, timezone, "MM-dd");
  for (const entry of entries) {
    if (entry.date === ymd || entry.date === md) return entry;
  }
  return null;
}
```

Two-format match is O(n) per fire; n is realistically <50 entries per year. No optimization needed.

## Why labels are required

Skipping silently on a date is confusing. With a required `label`:

- Logs say `Cron job <id> skipped by skipDates (Christmas)` — operator knows why.
- Future Home Tab UI can render `Today: skipped (Christmas)`.
- Cost is one extra string per entry in the config — trivial.

## Validation strategy

Same pattern as `trivia.games[]` parsing: log a warning and drop the bad entry. Don't throw. Reasons:

- Config files are admin-edited; a typo on one of 15 entries shouldn't break the bot at boot.
- The existing `trivia` config patterns (games, choices, questionsTypes) all use warn-and-drop. Be consistent.
- Loud warnings during config-load mean operators see the problem in logs the next time they restart, without needing to investigate why their cron job skipped erroneously.

Invalid cases that warn-and-drop:
- `date` not a string
- `date` not matching `^\d{4}-\d{2}-\d{2}$` or `^\d{2}-\d{2}$`
- `date` matching one of the patterns but representing an invalid calendar date (e.g. `02-30`)
- `label` missing or empty
- non-object entries

## Migration

None needed. The `skipDates` field is purely additive — pre-existing cron jobs have `skipDates === undefined` and behave exactly as today. The trivia config is also additive — `trivia.offDays === undefined` means no skips.

## Test surface

- **Config parser:** valid entries; each invalid shape gets dropped with a warning; mixed valid+invalid keeps the valid ones.
- **`matchesSkipDate`:** exact date match, recurring `MM-DD` match, timezone correctness (UTC midnight vs Montreal noon on a date boundary), empty/undefined list.
- **`buildGameSpecs`:** propagates `offDays` into every emitted spec's `skipDates`; absent `offDays` yields specs without `skipDates`.
- **`executeJob`:** skip path records `status: "skipped"` and never calls `processMessage`; non-skip path is unchanged; `oneShot` still deletes on a skip; the existing `skipConditions` path still works after the new gate is added (gates compose).
- **Replay:** `asOf = off-day` → skipped; `asOf = normal day` → fires; matches existing `skipConditions` replay docs.

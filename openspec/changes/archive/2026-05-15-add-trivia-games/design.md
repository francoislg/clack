## Context

Plugin-managed schedules just shipped (`plugin-managed-schedules`), providing `sdk.reconcileCronJobs(ownerKey, specs[])`. The trivia plugin already has its substantive prompts extracted into plain string constants in `src/plugins/trivia/scheduledPrompts.ts` (the prior session unwrapped them from the deleted `*Instructions.ts` tool files). What remains is to wire it together: read a config block, build specs, call reconcile, migrate the prior generation of admin-created cron jobs.

The migration is the trickiest piece. Today's trivia cron jobs come in two shapes:
1. **Dispatcher pattern** (post-`thin-prompts` refactor): `prompt: "Call send_questions_instructions and follow the returned instructions exactly."` These are easy to recognize by string match.
2. **Inline fat prompts** (legacy): full multi-line trivia setup baked into `prompt`. Some operators may have edited these by hand.

The migration only auto-converts the dispatcher pattern (it can recover `channel`, `cronExpression`, `timezone` cleanly). Inline fat prompts are left in place with a warning — the operator can decide whether to delete or keep them.

## Goals / Non-Goals

**Goals:**

- Make trivia schedules declarative: edit `config.trivia.games[]`, save, the schedules update.
- Eliminate the round-trip indirection: embedded prompts at reconcile time, no more dispatcher.
- Zero-touch upgrade for the typical operator: the migration converts their existing schedules; no manual recreation needed.
- Keep season-aware required-tools logic correct: reveal spec gains `check_season_status` only when seasons are enabled.

**Non-Goals:**

- Multi-game season isolation. Seasons remain workspace-global (`config.trivia.seasons.enabled` keeps its current scope). Per-game seasons would be a follow-up tracked in the parked `add-trivia-game-namespacing` change.
- Editing schedules from the Home Tab. Plugin-managed jobs show as read-only; editing is by editing config.
- Renaming a game. A rename = removing the old name from `games[]` and adding a new one. The old jobs (with the old `specKey`) are deleted; the new ones (with the new `specKey`) are created. Run history attached to the old `id` is lost — same as today's "delete + recreate" semantics. Documented in tasks.

## Decisions

### Decision 1: `name` is part of the `specKey`, not the `prompt`

`specKey: "ops-daily:question"` makes adding/removing games cleanly diff-able. If we used `(channel, cronExpression)` as the key, renaming a game while keeping its cron would orphan + recreate (losing history). With `name`, the cron can change freely and the job is updated in place.

### Decision 2: Both schedules in a single game entry, not separate `schedules[]`

The config shape is `{ name, channel, questionCron, revealCron, timezone }` — not `{ name, schedules: [{kind, cron}, ...] }`. The trivia flow has exactly two schedules per game (question + reveal); modeling them as a fixed pair keeps the schema simple, validation specific (we can enforce "question before reveal on each weekday" against this pair), and the plugin code straightforward.

### Decision 3: `timezone` is required per-game, not workspace-default

Different trivia games can run in different timezones (an EU office's "morning post" is at a different absolute time than a North American team's). The config requires `timezone` per game; no workspace-wide default to avoid silent wrong-tz disasters. Validation rejects empty/invalid IANA tz strings.

### Decision 4: Reveal-before-question is a warning, not an error

A misconfiguration that reveals the answer before posting the question is *almost always* a typo. But "earlier on the same day" depends on the cron expression's day-of-week match, and there are edge cases (different days of week) where the inversion is intentional. The plugin emits a logged warning when next-fire-time for the reveal would be earlier than next-fire-time for the question on any matching weekday, but doesn't block reconcile.

### Decision 5: Migration auto-mode is dispatcher-only

The migration recognizes a cron job as convertible iff (a) `plugin === "trivia"`, AND (b) its `prompt` matches one of the known dispatcher patterns. Inline-fat-prompt jobs are left untouched with a per-job warning. Reason: rewriting an inline prompt risks losing operator customizations; better to let the operator decide.

The migration pairs candidates by channel: it expects exactly one question schedule and one reveal schedule per channel (heuristic: the cron with the earlier hour-of-day is the question; the later one is the reveal). Mismatched pairs (e.g. two question crons in one channel) are skipped with a warning.

### Decision 6: Default-config instruction cleanup is in-scope

The bot's `data/default_configuration/` files instruct Claude how to set up trivia. Those references are now obsolete. This change rewrites them to point at the config-driven flow instead — a one-paragraph note that says "Trivia schedules are now declared in `config.trivia.games[]`. To add a game, edit the config; the bot will create the schedules on next reload."

## Risks / Trade-offs

- **Risk:** the migration runs once and is irreversible — once it deletes legacy cron jobs and adds `games[]` entries, downgrading is manual. → **Mitigation:** the migration logs every converted (job-id, derived game) pair so operators can restore by hand if they downgrade. Recommend a `data/state/cron-jobs.json` snapshot before deploying.

- **Risk:** an operator's hand-edited config (`trivia.games[]`) gets validated to invalid (typo in timezone, malformed cron). Reconcile skips that spec but the bot keeps running. → **Mitigation:** per-spec validation logs the offending `name` and specific error; the plugin won't reconcile what it doesn't understand, but valid neighbors apply. The operator sees the failure in logs and via the Home Tab (the missing job won't appear in the Plugin Scheduled Messages section).

- **Risk:** seasons-on/off is checked at reconcile time. If an operator toggles `trivia.seasons.enabled`, the next reconcile updates the reveal spec's `requiredTools`. Mid-day toggles mean a partial-day "old required tools" period. → **Acceptable.** Operators don't toggle seasons mid-day.

- **Trade-off:** legacy migration only handles the dispatcher pattern. Inline-fat-prompt operators have to delete their old jobs manually and let the new reconcile re-create them. → **Documented in tasks.**

## Migration Plan

1. **Add `TriviaGame` schema** to `src/config.ts`. Existing deployments without `trivia.games[]` are unaffected.
2. **Wire the reconcile call** in `src/plugins/trivia/index.ts`. When the config has no `games[]`, the call passes an empty array — which deletes any plugin-managed trivia jobs but leaves user-created ones intact.
3. **Ship the migration.** Runs on first boot post-upgrade. Idempotent: re-running finds no candidates and is a no-op.
4. **Update default config** instruction files so Claude no longer suggests the wizard.
5. **Verify in production**: check `cron-jobs.json` shows the new `pluginManaged: true` rows, the Home Tab plugin section displays them, and the next fire produces the expected output.

**Rollback:** delete the migrated `games[]` entries from `data/config.json`, restore `data/state/cron-jobs.json` from the snapshot, and downgrade.

## Open Questions

- **Should `oneShot` be supported in a game spec?** No for v1 — trivia games are inherently recurring. If a one-off play is ever needed, the existing `create_scheduled_message` tool still works.
- **What's the right default behavior when seasons-on and `currentCategories` is empty?** Out of scope here — that's a seasons-init concern; the reconcile spec just embeds the prompt regardless.

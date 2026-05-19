## Why

The `add-trivia-post-questions-tool` change relocated the actual trivia question delivery from `submit_response` to a plugin-owned `post_questions` tool. The cron prompt then instructs Claude to call `submit_response({ skip_response: true })` to terminate the run without delivering anything user-facing. This silently fails today: `skip_response` is only exposed in the `submit_response` schema for scheduled runs that have a non-empty `skipConditions` field (see `src/tools/server.ts:271`). The trivia question cron has `requiredTools` but no `skipConditions`, so Zod rejects `skip_response: true` as an unknown parameter, and Claude falls back to delivering a stray confirmation block ("✅ Trivia question posted.") that duplicates the message just posted by `post_questions`.

The underlying gap is more general: any cron-driven flow whose actual deliverable comes from a non-`submit_response` tool (a plugin posting tool, an external integration, a queued action) has no clean way to say "the run should complete WITHOUT submitting a response, period." Today's options are:

1. Add a synthetic `skipConditions` string so `skip_response` becomes available — abusing a field meant for "evaluate these conditions and skip when true" to unconditionally allow skipping. Misleading to operators reading the cron config.
2. Have the plugin tool quietly mark the run as delivered — opaque side effect that's hard to reason about and impossible for Claude to acknowledge directly.
3. Let Claude deliver whatever stray message it improvises — today's broken behavior.

None of these are honest. The job needs to declare its mode explicitly: "this run produces its deliverable via X tool; submit_response should refuse to deliver anything and only accept a no-op skip."

## What Changes

- Add an optional `submitResponseMode` field to the `CronJob` data model in `src/cronJobs.ts` and to `CronJobSpec` in `src/plugins/sdk.ts`. Allowed values: `"always" | "optional" | "skipped"`. Absent field preserves today's behavior (allowSkip derived from triggerType + skipConditions). Field SHALL persist round-trip through `data/state/cron-jobs.json` and through `reconcileCronJobs` updates.
- Add the new field as an optional argument on the `create_scheduled_message` MCP tool so user-created scheduled messages can declare a mode. The arg defaults to absent.
- Pass the mode through the scheduler → handler → submit_response pipeline. The chain runs: `cronScheduler.executeDynamicJob` → `processMessage(askClaudeOptions)` → `submit_response` tool's `SubmitResponseDeps`.
- Introduce a "skipped-only" `submit_response` schema variant that accepts ONLY `{ skip_response: true }` (a `z.literal(true)`). The schema MUST reject any other keys (`blocks`, `actions`, `table`, `reactions`, `disengage`, `post_top_level`, `message`) at the Zod boundary so Claude physically cannot deliver content. When `submitResponseMode === "skipped"` this is the schema Claude sees.
- Update the existing schema-selection logic in `src/tools/server.ts` so:
  - `mode === "always"` → `allowSkip = false` (force-disable skip regardless of trigger or `skipConditions`).
  - `mode === "optional"` → `allowSkip = true` (force-enable skip regardless of trigger).
  - `mode === "skipped"` → skipped-only schema replaces the normal one entirely.
  - `mode === undefined` → today's auto-derivation rules unchanged.
- Update the prompt-guidance branch in `src/claude/promptBuilder.ts` (or wherever scheduled-prompt guidance is rendered) to add a `"skipped"`-mode hint: "this run's deliverable is produced by another tool; call `submit_response({ skip_response: true })` to terminate." No-op for other modes.
- Existing scheduled jobs without the field continue working unchanged. No data migration.

## Capabilities

### New Capabilities

- `submit-response-mode`: declares the `submitResponseMode` field's three values, the "skipped-only" `submit_response` schema variant, and the precedence rules over the existing trigger/skipConditions derivation.

### Modified Capabilities

- `cron-messages`: the `CronJob` data model SHALL accept an optional `submitResponseMode` field; CRUD operations and `reconcileCronJobs` propagation handle it.
- `skip-response`: the existing trigger/`skipConditions`-derived schema-gating rules SHALL apply only when `submitResponseMode` is undefined; otherwise the mode takes precedence. Prompt-guidance branches also key on the mode.
- `clack-tools`: the user-facing `create_scheduled_message` tool SHALL surface the new optional argument with clear documentation about when each mode is appropriate.
- `trivia-managed-schedules`: the trivia plugin's `buildGameSpecs` SHALL set `submitResponseMode: "skipped"` on every question spec emitted (and leave it unset on reveal specs). This is the opt-in that fixes the stray-confirmation bug introduced by the `add-trivia-post-questions-tool` change. Co-located here (rather than as a separate follow-on) so both changes land together in one deploy.

The `clack-tool-response` capability is NOT modified. The new `"skipped"`-mode schema variant lives entirely inside the new `submit-response-mode` capability; existing `submit_response` requirements (required-tools gate, intent coverage, etc.) continue to apply unchanged under all three modes.

## Impact

- **Edited**: `src/cronJobs.ts` (data model + persistence + `updateJob` accepts the new field).
- **Edited**: `src/plugins/sdk.ts` (`CronJobSpec` interface).
- **Edited**: `src/cronScheduler.ts` (thread the mode through to the session/handler context).
- **Edited**: `src/slack/handlers/core.ts` (or wherever `askClaudeOptions` is constructed) to pass the mode down.
- **Edited**: `src/tools/server.ts` (schema selection + allowSkip override).
- **Edited**: `src/tools/presentation/submitResponse.ts` (new skipped-only Zod schema variant).
- **Edited**: `src/tools/actions/createScheduledMessage.ts` (new optional arg).
- **Edited**: `src/claude/promptBuilder.ts` (skipped-mode prompt hint).
- **Edited**: `openspec/changes/add-trivia-post-questions-tool/tasks.md` — one new task: "set `submitResponseMode: 'skipped'` on the question spec in `buildGameSpecs.ts`." Both changes must land in the same deploy for the trivia question flow to work without the stray-message bug.
- **No data migration**: existing jobs without the field default to today's auto-derivation rules.
- **No breaking changes**: cron config schema, plugin SDK, and `create_scheduled_message` arg surface are all additive.
- **Relationship to `add-trivia-post-questions-tool`**: this change is the unblock. The trivia change ships a known stray-message bug until this change lands.

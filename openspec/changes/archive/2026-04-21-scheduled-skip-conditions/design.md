## Context

Scheduled messages (`cronJobs`) currently always post a response when they fire. `skip_response` on `submit_response` is gated by `shouldAllowSkip(triggerType)` in `src/tools/server.ts:240` and is hard-coded to reject the `scheduled` trigger. The spec `openspec/specs/skip-response/spec.md:113` formalizes this. As a result, prompt-level instructions like "skip if X" produce a posted "I'm skipping because X" message rather than actual silence.

Cron job definitions live in `data/state/cron-jobs.json` (see `src/cronJobs.ts`) and are managed by three MCP tools (`create_scheduled_message`, `update_scheduled_message`, `list_scheduled_messages`, plus `get_scheduled_message_runs`) and the Home Tab's scheduled-message rows.

## Goals / Non-Goals

**Goals:**
- Let operators opt in to skippable scheduled runs per-job via an optional `skipConditions: string` field.
- Make skip availability data-driven (presence of `skipConditions`) rather than a global policy flip, so jobs without the field keep today's behavior.
- Cover the full lifecycle: create/update/list/runs tools, Home Tab view + edit, prompt injection, delivery short-circuit, and run history.

**Non-Goals:**
- Enabling `skip_response` globally for `scheduled`.
- Reworking the cron job storage format beyond an additive field.
- Changing the `skip_response` acknowledgment safeguard, disengage semantics, or auto-respond/threadReply behavior.
- Adding structured "condition DSL" — `skipConditions` is free-form text evaluated by Claude, like the existing `prompt`.

## Decisions

### Opt-in per-job rather than a global `scheduled` skip

`shouldAllowSkip("scheduled")` stays `false`. In `createToolServer` (`src/tools/server.ts:408`), the scheduled branch additionally checks for a `ctx.session.skipConditions` (or equivalent job-derived flag) and sets `allowSkip: true` when present. Alternative considered: always expose `skip_response` to scheduled runs and rely on prompt discipline. Rejected — most scheduled jobs should never skip (digests, reminders, announcements); making skip always-available would encourage Claude to decline legitimate runs.

### `skipConditions` is a free-form string

The field is `string | undefined`, injected verbatim into the system prompt. Alternative considered: structured rules (e.g., `{ unlessChannelSilentFor: "24h" }`). Rejected — users already express scheduling semantics in natural language through `prompt`; a parallel DSL would diverge and demand its own validator.

### Prompt injection lives next to the scheduled branch in `promptBuilder`

`src/claude/promptBuilder.ts:155` (the `triggerType === "scheduled"` branch) gains a conditional block that renders when `skipConditions` is set: a short pre-check instruction telling Claude to evaluate the conditions before doing anything else and to call `submit_response` with `skip_response: true` plus the required acknowledgment if any apply. The acknowledgment string is *not* embedded in the prompt (matching `openspec/specs/skip-response/spec.md:127`) — the tool schema enforces it. Alternative considered: inject at the cron-scheduler layer. Rejected — prompt assembly is already the single place for trigger-aware prompt content.

### Skip short-circuit in `cronScheduler.ts`

`askClaude` already exposes `response.skipped`. The scheduled delivery path checks for it and returns without posting. Because scheduled runs do not use a `SlackStreamer` the same way DM/mention flows do, there is no `chat.delete` step — the skip is just "don't invoke the poster." `updateJobRunStatus` is called with a new `"skipped"` status instead of `"success"` / `"error"`.

### Storage + MCP tools thread the field additively

- `CronJob.skipConditions?: string` added to `src/cronJobs.ts` types.
- `CreateCronJobParams` and `UpdateCronJobParams` gain `skipConditions` (create: set when non-empty; update: `undefined` leaves unchanged, empty string clears — matches existing `plugin` semantics at `src/cronJobs.ts:203`).
- `create_scheduled_message` / `update_scheduled_message` expose `skipConditions` as optional string.
- `list_scheduled_messages` returns `skipConditions` alongside existing fields.
- `get_scheduled_message_runs` returns the new `skipped` status on runs.

### Home Tab: view inline, edit via existing modal

The scheduled-message row in `src/slack/homeTab.ts` gains a context line showing the conditions (truncated) when set — similar to how `requiredTools` is currently surfaced. The existing edit modal adds a multi-line input for `skipConditions`, wired to `updateJob`. View is available to anyone who can see scheduled messages; edit follows the same role gate as the rest of the edit modal.

### Run history status extended to three states

`CronRun.status` becomes `"success" | "error" | "skipped"`. `job.lastRunStatus` mirrors this. Historical runs remain backward-compatible (existing values are still valid). Home Tab and the runs tool render the three states distinctly.

## Risks / Trade-offs

- **Risk:** Claude interprets `skipConditions` too aggressively and silences important jobs. **Mitigation:** The skip safeguard acknowledgment string is still required, the feature is opt-in per job, and the run history records skip events so operators can audit them.
- **Risk:** Adding another optional field bloats the create/update tool surface. **Mitigation:** Field is plainly named and mirrors `prompt`'s shape; the update tool already uses the same optional-to-clear convention.
- **Risk:** Skip path regressions affect non-scheduled triggers. **Mitigation:** `shouldAllowSkip` is unchanged; the override is additive and scoped to the scheduled branch of `createToolServer`.
- **Risk:** Older stored runs with only `"success" | "error"` need to render cleanly after the status union widens. **Mitigation:** Union is additive; UI treats any unknown status as neutral. No migration needed.
- **Trade-off:** `skipConditions` is natural-language, so the model — not a validator — decides what counts. This matches how `prompt` already works and keeps the feature cheap; the cost is non-determinism, offset by the audit trail.

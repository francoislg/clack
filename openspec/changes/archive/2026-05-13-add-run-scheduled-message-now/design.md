## Context

Clack's cron scheduler (`src/cronScheduler.ts`) fires dynamic jobs by invoking `processMessage` with `triggerType: "scheduled"`. When a job fails, the only recovery paths today are (a) wait for the next matching tick, or (b) recreate the job via `create_scheduled_message`. There's an internal `runJobNow(job, client)` helper at `src/cronScheduler.ts:188` but it isn't exposed to Claude as an MCP tool.

Two adjacent observations motivate the design:

1. **The retry conversation is repetitive.** Users hit a failed run, ask Clack to retry, and Clack has no canonical tool path — it either fakes one via `create_scheduled_message` with a near-immediate `oneShot`, or asks an admin to intervene.
2. **Replays need date context.** A daily-digest schedule from 5 days ago, retried today, must reason as if it were 5 days ago (`"yesterday's PRs"` etc.). A naive retry sees today's wall-clock date and produces wrong content.

The retry use case generalizes cleanly: it's "fire this job now, optionally with a back-dated frame of reference, optionally replacing a prior post." Three modes collapse into one tool.

## Goals / Non-Goals

**Goals:**

- One tool that handles plain "run now", retry-with-date, and replace-prior-post in a single call.
- Creator OR admin permission (matches `cancel_scheduled_message`'s model).
- Creators can delete _their own job's_ prior bot post without admin elevation — implicit ownership via membership in `runs[].responseTs`.
- Date displacement implemented prompt-only (no deep plumbing into `PromptOptions` / `AskClaudeOptions` / `ProcessMessageParams`).
- Run history records the replay anchor for debugging.

**Non-Goals:**

- General-purpose "back-date any Claude run" feature. The `asOf` mechanism stays on the cron-execution path; other entry points to `processMessage` are untouched.
- Cleanup of the failure DM Clack sends to the creator on errored runs (different channel, separate concern, out of scope for v1).
- Reasoning about time-sensitive _tool calls_ (e.g., a GitHub PR-filter call uses real wall-clock time, not `asOf`). Claude is expected to interpret `asOf` for prompt reasoning; honest about the limit in docs.
- Re-evaluating `skipConditions` against an `asOf` date. Skip conditions evaluate present-time state — a replay may run when the original would have skipped, or vice versa. Document the limitation rather than try to be clever.
- Exposing `runJobNow` as a no-args trigger. The new tool covers that case via `{ id }`.

## Decisions

### D1. API shape: `asOf` as ISO datetime, with default fallback

The tool accepts `asOf?: string` (ISO 8601 datetime). When omitted:

- If `runs[]` is non-empty → default to the most recent run's `executedAt`.
- If `runs[]` is empty → no asOf is set (the run fires with current wall-clock date as `CURRENT DATE`).

**Alternative considered:** indexing into `runs[]` (`runIndex: number`). Rejected because `runs[]` is mutable (entries grow over time, and the array may be truncated later), and the prompt builder already wants a `Date`-shaped value internally. Direct ISO datetime decouples the tool from run-array layout.

### D2. Bundled delete via `replaceResponseTs`

The tool accepts `replaceResponseTs?: string`. When set:

- The tool verifies the `ts` appears in this job's `runs[].responseTs` set (implicit Clack-ownership check).
- The tool calls `chat.delete` on `(job.channel, replaceResponseTs)` before firing.
- Failure to delete is _not_ fatal — log a warning, continue with the fire. Failure modes (`message_not_found`, etc.) are common when the message has already been deleted manually.

**Alternative considered:** require operators to call `admin_delete_message` separately. Rejected because `admin_delete_message` is admin-gated, so a non-admin creator can't clean up their own scheduled-post failure. Bundling the delete makes the scoped permission ("delete a Clack-posted message that belongs to your own job") implicit and safe.

### D3. Date displacement is prompt-only

The cron executor (`executeDynamicJob`) accepts an optional `asOf: Date` and, when present, appends a **REPLAY CONTEXT** block to the `additionalSystemPrompt` it already passes in (currently just `buildAttribution(job)`). The block tells Claude to treat the effective current date as `asOf` when interpreting relative date language and filters.

No changes to `PromptOptions`, `AskClaudeOptions`, `ProcessMessageParams`, `ProcessingContext`, or `buildPrompt`. The `CURRENT DATE` line in the system prompt still shows the real wall-clock date — Claude is expected to reconcile the two signals, treating the explicit instruction as authoritative.

**Alternative considered:** thread `asOfDate?: Date` through `ProcessMessageParams` → `ProcessingContext` → `AskClaudeOptions` → `PromptOptions` → `buildPrompt` and override the `CURRENT DATE` line directly. Rejected for now: (a) it's significantly more code surface for a feature with one caller, (b) the user has observed that prompt-level instructions already produce correct date reasoning in practice, (c) we can swap to the deeper plumbing later if testing reveals Claude leaking the wall-clock date in tool calls.

### D4. Permission model: creator OR admin

Matches `cancel_scheduled_message`'s gating. Non-admins receive a friendly error when attempting to run someone else's job.

### D5. Run-history provenance via `replayOf`

When `asOf` is set, the new entry appended to `job.runs[]` carries an optional `replayOf: string` field (ISO datetime, the value of `asOf`). Plain run-now invocations (no asOf) get no `replayOf` field. This is observable in `list_scheduled_messages` and `get_scheduled_message_runs` output so operators can see why a particular run was on a different cadence.

### D6. Tool naming: `run_scheduled_message_now`

Mirrors the existing internal `runJobNow` helper. Verb-prefix matches the CRUD-family (`create_*`, `update_*`, `cancel_*`, `list_*`).

**Alternative considered:** `retry_scheduled_message`. Rejected because the tool's three modes — plain run, retry, replace — generalize beyond "retry." Naming it for one mode would mis-frame the others.

## Risks / Trade-offs

- **[Risk]** Claude may leak the real wall-clock date through tool calls (e.g., a GitHub query using `since: <today>` instead of `since: <asOf>`) → **Mitigation:** scheduling.md guidance explicitly addresses this. If observed in practice, escalate to the deeper-plumbing path (D3 alternative).
- **[Risk]** `replaceResponseTs` is supplied but doesn't appear in `runs[]` (e.g., user typo or message from a different job) → **Mitigation:** tool returns a clear error before any side-effect.
- **[Risk]** A replay run hits the `requiredTools` gate (defined for the original cadence) but the required tool's state has drifted (e.g., a Statsig flag was deleted) → **Mitigation:** required tools still apply on replay; failure is expected behavior. Document in scheduling.md.
- **[Risk]** Bundled delete fails (network, permissions, message already deleted) → **Mitigation:** non-fatal — log + continue with fire. Tool result includes a `replacedPriorPost: boolean` so Claude can report accurately.
- **[Trade-off]** Run history grows by one entry per ad-hoc run. Same as a normal tick fire, so no new bound is introduced.

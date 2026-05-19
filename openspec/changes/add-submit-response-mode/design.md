## Context

The `submit_response` tool's behavior is configured per-run through three implicit signals:

- `triggerType` (one of `"reactions" | "directMessages" | "mentions" | "scheduled" | "autoRespond" | "threadReply"`).
- The cron job's optional `skipConditions` string (used to derive `allowSkip` for scheduled runs).
- The session's `requiredTools` list (used by the gate to refuse delivery when prerequisites are missing).

Combining these into the actual schema lives in `src/tools/server.ts:271` — `computeAllowSkip(triggerType, skipConditions)`. The rule today: scheduled triggers expose `skip_response` only when `skipConditions` is set. Other scheduled runs cannot decline to deliver.

That rule held up while every cron-driven flow's deliverable came from `submit_response` itself. The `add-trivia-post-questions-tool` change shifted the trivia question flow's deliverable to a plugin-owned `post_questions` tool — and added a step instructing Claude to call `submit_response({ skip_response: true })` purely as a run terminator. The bug surfaced immediately: with no `skipConditions`, `skip_response` isn't in the schema, Claude can't pass it, and Claude's fallback (an LLM doing what it thinks the prompt wants) is to deliver a stray confirmation block. Two messages land in the channel — the real question and a duplicate ack — and neither the prompt nor the schema prevented it.

The fix could be hyper-local (e.g., expose `skip_response` whenever `requiredTools` is non-empty), but the underlying issue is that the cron job has no way to **declare** its delivery semantics. The auto-derived rules read intent from indirect signals (does it have skipConditions? does it have required tools?) and guess. An explicit field that says "this run must skip" / "this run must deliver" / "either is fine" — a real `submitResponseMode` — is honest, future-proof, and audited at the schema layer so Claude can't accidentally drift.

## Goals / Non-Goals

**Goals:**

- Let cron job authors declare `submit_response`'s mode explicitly: `"always"` (force delivery, no skip), `"optional"` (skip is available), `"skipped"` (skip is required — the schema accepts only `{ skip_response: true }`).
- Eliminate the stray-message class of bug introduced by `add-trivia-post-questions-tool` at the schema layer (Zod rejects), not at the prompt layer (instructions Claude can ignore).
- Keep today's behavior intact when the field is unset. Existing cron jobs continue working with no migration.
- Generalize: any cron-driven flow whose deliverable is produced by a non-`submit_response` tool can opt into `"skipped"` mode. Not trivia-specific.
- Surface the new field on `create_scheduled_message` so user-created scheduled messages can declare it too.

**Non-Goals:**

- Replacing `submit_response` as the run-completion gate. `submit_response` is still required to fire; `"skipped"` mode just constrains WHAT it can carry.
- Auto-detecting the mode from `requiredTools` membership. Authors must declare it explicitly. Auto-detection would re-introduce the "guess from indirect signals" problem this change exists to fix.
- Adding new modes beyond the three listed. A fourth value would be a separate change with its own justification.
- Backfilling `submitResponseMode` onto existing trivia jobs in `cron-jobs.json` at deploy time. The trivia plugin's `reconcileCronJobs` call already overwrites plugin-managed specs on every load, so the new mode flows in naturally.
- Changing how the `requiredTools` gate behaves. It runs before the skip branch today and continues to do so under all three modes — a `"skipped"` run still must satisfy `requiredTools` before the skip is accepted.
- Touching non-scheduled trigger types (autoRespond, threadReply, reactions, etc.). The mode field is on `CronJob`, which only exists for scheduled triggers.

## Decisions

### Decision 1: Three explicit modes, not a binary `allowSkip` toggle

Considered alternatives:

- (a) A boolean `allowSkip?: boolean` field. Lets authors override the auto-derivation in one direction (true/false), but offers no way to express "skip is REQUIRED."
- (b) A `requireSkip?: boolean` field added alongside the existing `skipConditions` logic. Two booleans interact ambiguously when both are set.
- (c) **Chosen:** A single tristate `submitResponseMode?: "always" | "optional" | "skipped"`. Each value names exactly one intent; combinations don't exist; the absent state means "use today's rules."

The tristate spells out every cell of the decision matrix. Future extensions (e.g., a `"choice"` mode for runs that must deliver a structured action) can become new values rather than new fields.

### Decision 2: `"skipped"` is enforced at the Zod schema, not at the handler

The handler-level alternative: keep today's schema, add a runtime check that returns an error when `mode === "skipped"` and the call doesn't carry `skip_response: true`. Claude sees the error and retries.

The Zod-level approach: when `mode === "skipped"`, swap in a schema that ONLY accepts `{ skip_response: z.literal(true) }`. Any other shape is rejected at parsing, before the handler runs.

Chosen: **Zod-level.** Rejecting at the schema layer makes the constraint visible in the tool's published signature (Claude sees the input schema in its tool-listing). With the handler-level approach, Claude sees the full schema and might believe `blocks` is a valid argument until the handler rejects it — slower retry loop, more wasted tokens, more confusion. The Zod-level approach makes the constraint structural.

### Decision 3: Unset field preserves current behavior

Considered alternatives:

- (a) Make `submitResponseMode` required on all new cron jobs going forward. Breaking change. Doesn't pay its way.
- (b) Auto-fill `submitResponseMode` based on existing fields at load time. E.g., a job with `skipConditions` set gets `mode: "optional"`. Mechanically converts the auto-derivation into stored data — but loses the "field is unset → defer to derivation" signal that lets future rule changes still apply to legacy jobs.
- (c) **Chosen:** Leave the field optional and absent on every existing job. The auto-derivation rules continue to apply when the field is unset. Authors opt in explicitly when they want override behavior.

This keeps the change additive and lets the rules continue to evolve for jobs that haven't opted in.

### Decision 4: The mode lives on `CronJob`, not on the session

`CronJob` is the persistent declaration; the session is a per-run derivation. Two reasons the mode belongs on the cron job:

1. **Audit:** Operators reading `data/state/cron-jobs.json` or inspecting the Home Tab can see the declared mode without reconstructing it from session state.
2. **Reconcile:** Plugin-managed crons get rewritten on every plugin load via `reconcileCronJobs`. Storing the mode on the cron means the plugin's spec is the source of truth and `updateJob` propagates changes correctly.

The session-level context still carries the mode (threaded from `cronScheduler` → `processMessage` → submit_response deps), but it's a pass-through, not an independent setting.

### Decision 5: Plugin-spec authors set the mode in `CronJobSpec`; user-facing crons get a `create_scheduled_message` arg

For plugin-managed crons (`reconcileCronJobs`-emitted), authors set `submitResponseMode` directly on each `CronJobSpec`. Pre-existing plugins continue working — the field is optional. The trivia plugin's `buildGameSpecs.ts` will set `"skipped"` on the question spec only.

For user-created crons via `create_scheduled_message`, the tool exposes the new field as an optional Zod argument. Claude users describing a scheduled message ("post a daily digest at 9am, then skip if no PRs merged") rarely need the field, but power users wanting a strict gate (e.g. "the run posts via [external tool] and shouldn't say anything else") can pass it explicitly. Defaulting to absent means most invocations don't pay any complexity.

### Decision 6: requiredTools gate runs before the skip branch — unchanged

Under all three modes, the existing `requiredTools` gate still fires first. A `"skipped"` run that hasn't called all required tools is rejected with the standard missing-tools error, even if Claude correctly passes `skip_response: true`. Claude is expected to call the missing tools and then retry.

This matches today's behavior for the `"optional"` path and preserves the operator's guarantee that declared prerequisites are satisfied before any termination.

## Risks / Trade-offs

[**Risk: schema variants proliferate.**] → Mitigation: the `"skipped"` variant is small (one literal field). Adding a fourth mode in the future would require another variant, but the precedent is bounded and each variant has narrow scope. The alternative (one schema with conditional validation) would be more flexible but also more confusing to read.

[**Risk: prompt drift between modes.**] → The existing scheduled-mode prompt guidance is rendered in `promptBuilder.ts` based on `skipConditions` presence. Adding a `"skipped"`-mode hint there means three rendering branches (no guidance / skipConditions guidance / skipped guidance). Cleanest: a small lookup table keyed on `submitResponseMode + skipConditions` that picks the right guidance string. Manageable; the alternative (per-plugin custom prompt guidance) is worse.

[**Risk: a plugin sets `"skipped"` but doesn't provide a deliverable tool.**] → The result is a run that posts nothing visible — the run completes successfully (gate passes, skip succeeds), but no message lands in the channel. Detection isn't part of this change; it'd require a separate "deliverable assertion" mechanism. Operators discover the issue by noticing no message; that's acceptable for an opt-in field.

[**Risk: `create_scheduled_message` surface area grows.**] → One more optional Zod arg, documented in the tool description. The tool already has several optional args; one more is incremental and clearly described.

[**Risk: future change wants `submitResponseMode` on non-cron sessions.**] → Out of scope. The field is declared in `CronJob` because that's where the declarative scheduling configuration lives. If a future need arises for autoRespond/threadReply contexts, that change can introduce its own seam.

[**Risk: deploy ordering with `add-trivia-post-questions-tool`.**] → The trivia change ships with a stray-message bug until this change lands. Both changes must be deployed together. Operators deploying only `add-trivia-post-questions-tool` will see the bug in production. Mitigation: explicitly note the dependency in both changes' proposals; sequence the merge to land both within the same release.

[**Risk: persisted jobs whose mode is later removed from the spec.**] → If a plugin's `CronJobSpec` drops the `submitResponseMode` field after a deployment that included it, `updateJob` should clear the existing value (rather than leaving the stale mode). The reconcile path already treats empty/undefined fields as "clear" for `skipConditions` and `skipDates`; this change extends that pattern to the new field.

## Migration Plan

1. Land `add-submit-response-mode` first (or co-deploy with `add-trivia-post-questions-tool`).
2. On first plugin load after deploy, `reconcileCronJobs` updates the trivia question crons in `cron-jobs.json` to include `submitResponseMode: "skipped"` (assuming the trivia change has also been deployed with its opt-in task complete).
3. Existing cron jobs without the field continue working unchanged — auto-derivation rules apply.
4. No data migration. The optional field simply appears on newly-written rows.

Rollback: revert the change. The auto-derivation logic in `src/tools/server.ts` reverts; the field becomes ignored when loading old persisted jobs (the JSON load is permissive about extra keys, but reverted code paths won't read the field). Re-deploys must re-add the field handling.

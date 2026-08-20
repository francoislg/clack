# Design

## D1 — One access-predicate module

New `src/tools/cronJobAccess.ts` exporting a small set of predicates over `(job, ctx)`:

- `canViewFull(job, ctx)` — `canManageRoles(ctx.role)` (admin/owner tier) OR `job.createdBy === ctx.userId` OR `job.editableByAnyone === true`. Plugin-managed jobs (`createdBy: null`) remain fully visible to everyone, as today.
- `canEdit(job, ctx)` — same predicate; gates `update_scheduled_message` (content + `enabled`) and `run_scheduled_message_now`.
- `canDelete(job, ctx)` — admin OR owner ONLY (`editableByAnyone` deliberately does NOT satisfy it); gates `cancel_scheduled_message`. Deleting a shared job is more destructive than editing it — the recoverable off-switch for shared jobs is `enabled: false`.
- `isPrivateTarget(job)` — channel starts with `D`, or user-created with no channel; such jobs are visible only where `canViewFull` holds (DM privacy carve-out).

Mutation tools keep their existing `pluginManaged` rejections layered on top (reconcile owns plugin jobs' lifecycle). This replaces the five duplicated inline `!isAdmin && job.createdBy !== ctx.userId` checks (`get`, `runs`, `update`, `cancel`, `run-now`). One module, one test file, no drift.

## D2 — One projection function for full vs redacted rows

The list tool's row formatter becomes `formatJob(job, { full: boolean })` producing both shapes from one function, so the field sets cannot drift:

- **Full** (viewer passes `canViewFull`): today's full row.
- **Redacted:** `id`, `name`, `channel`, `schedule` (human) + `cronExpression`, `enabled`, `oneShot`, `createdBy`, `systemActor`, `plugin`, `editableByAnyone`, `lastRunAt`, `lastRunStatus`, and `redacted: true`. No `prompt`, `skipConditions`, `requiredTools`, `attachedTopics`, `submitResponseMode`, `attentionLevel`, no `recentRuns`.

`redacted: true` tells Claude *why* fields are missing so it doesn't retry or hallucinate; the tool description explains the redaction rule and that the owner or an admin can act on those jobs.

## D3 — Flag toggle authority is owner/admin only

Editing a shared job's content and changing its *sharing policy* are different privileges. `update_scheduled_message` accepts `editableByAnyone` but applies it only when the caller is the job's owner or an admin — a third user editing a shared job cannot flip the flag (on or off). This prevents both hijack (share someone's private job) and lockout (unshare a team job).

## D4 — Plugin-managed jobs never carry the flag

`create`/`update` reject `editableByAnyone` on plugin-managed jobs. They are already visible to everyone, their lifecycle belongs to `reconcileCronJobs`, and the reconcile update-path would silently drop unknown spec-driven fields anyway.

## D5 — Persistence follows the skills pattern

`editableByAnyone: z.boolean().optional()` on `cronJobZod` (graceful reader — absence reads as `false`, no migration, no quarantine risk). Serialization writes the field only when `true` (`...(job.editableByAnyone ? { editableByAnyone: true } : {})`), matching `userSkills`' meta handling, so untouched jobs stay byte-identical on disk.

## D6 — `includeOtherUsers` is removed, not deprecated

The arg existed purely to widen a non-admin-hidden scope; with the scope now always-all it is meaningless. Admins lose nothing (they get full rows on every job by default). Removing the arg outright keeps the schema honest rather than carrying a no-op.

## D7 — Runs and run-now ride the same predicates

`get_scheduled_message_runs` gates on `canViewFull`; `run_scheduled_message_now` gates on `canEdit`. Shared jobs therefore become inspectable and runnable by anyone, consistent with "editable"; everything else behaves exactly as today.

## D8 — Disable is a tool-level first-class action, and "turn off" prefers it

`update_scheduled_message` gains `enabled: boolean` (omit to leave unchanged). Today no conversational path can disable a job — the Home Tab is the only pause switch, so "turn this automation off" in chat could only be satisfied by `cancel` (delete). With the field in place, tool descriptions steer Claude: "turn off"/"stop"/"pause" wording → `enabled: false` (recoverable); `cancel_scheduled_message` only on explicit delete/cancel/remove wording, always confirming by job name + owner first when the channel hosts more than one job.

## D9 — Home Tab: "Shared" terminology + three viewer-relative groups

**Terminology.** Every user-facing rendering of `editableByAnyone` says **"Shared"**: the skills badge `(editable by everyone)` becomes `(shared)`, and the new group headers use "Shared". The skill modal's checkbox keeps its explanatory sentence ("Allow anyone to edit this skill's content") under a "Shared" label — the label names the concept, the sentence explains it. All via `t()` with en + fr parity.

**Grouping (identical shape for Skills and Schedules).** Each section renders up to three subsections, each with its own header, omitted when empty, in this order:

1. **Shared** — `editableByAnyone` items, at the top. Full rows; Edit affordances for everyone (schedules: Edit button; the shared-flag toggle itself stays owner/admin — D3).
2. **Yours** — items the viewer owns that aren't shared. Full rows, full controls (today's behavior).
3. **Non-Accessible** — other users' non-shared items. Schedules render the redacted projection (name, channel, schedule, owner — no Edit button); skills render slug + owner without Edit. For admins this subsection is labeled **"Other users'"** instead (they CAN act on the rows, so "Non-Accessible" would lie) and keeps full controls. Others' DM-targeted/channelless jobs are excluded entirely (D1 `isPrivateTarget`).

**Schedules data source.** `buildScheduledMessagesSection` switches from `getJobsByUser(userId)` (non-admins) to `getJobs()` + partition through the same `cronJobAccess` predicates the tools use — the Home Tab and the tool layer can't drift. The admin-only plugin-managed subsection is unchanged and stays out of the grouping.

**Toggle.** Shared/Yours schedule rows owned by the viewer (or any row for admins) get the shared-flag toggle button; the action handler enforces owner/admin server-side — Block Kit visibility is UX, not security.

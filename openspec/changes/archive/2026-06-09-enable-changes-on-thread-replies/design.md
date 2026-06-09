## Context

The Changes Workflow tool set (`propose_change`, `request_update`, `cancel_worker_run`) is registered per turn in `buildClackTools` (`src/tools/server.ts:409`) when `canRequestChanges(ctx.role) && ctx.changesWorkflowEnabled`. `ctx.changesWorkflowEnabled` comes from `getClaudeOptions` (`src/slack/handlers/changeWorkflowHelper.ts`), which calls `isChangesEnabledForTrigger(triggerType, config)` and ANDs `canRequestChanges(role)`.

`isChangesEnabledForTrigger` (`src/changes/detection.ts`) historically hard-excluded `autoRespond`, `scheduled`, and `threadReply`. The live bug: a plain thread reply is a `threadReply` trigger, so the change tools were stripped and Clack fabricated a "tooling disconnected" outage (confirmed via `deferred_tools_delta` in the SDK log).

The maintainer's decision reframes the gate: the discriminator is **visibility**, not trigger type. The only invisible context is a **channelless cron dispatch** — `src/channelless.ts`, the `channelless:<jobId>` sentinel used by plugin cron jobs that have no bound channel and pick a destination at fire time. Everything else posts somewhere a human can see.

The `auto: true` auto-execute path (`handleAutoExecuteActions`, `src/slack/handlers/autoExecute.ts`) is already role-gated only (not trigger-gated) and runs after every response, including thread replies.

## Goals / Non-Goals

**Goals:**
- Changes Workflow available on `threadReply`, `autoRespond`, and channel-bound `scheduled` when global-enabled + visible + dev+.
- A channelless dispatch is invisible: no change tools, and intent auto-execute (change/config/update/skill) suppressed there.
- `threadReply` eligibility keyed off the replying user + visibility, never the thread starter or original trigger.
- The `auto` path works end-to-end on every visible trigger with no change to its permission logic.

**Non-Goals:**
- No change to the existing `mentions` / `directMessages` / `reactions` per-trigger opt-in semantics (kept non-breaking).
- No new config keys, no migration.
- Not blocking channelless `post_to` auto-delivery — channelless dispatch depends on it.

## Decisions

**Decision 1 — Visibility gate in `isChangesEnabledForTrigger`, with a `channelId` argument.**
New shape:
```
isChangesEnabledForTrigger(triggerType, config, channelId?):
  if (!config.changesWorkflow?.enabled) return false;        // global master switch
  if (isChannellessChannelId(channelId)) return false;        // invisible context
  if (triggerType is mentions | directMessages | reactions)   // preserve existing opt-in
    return config[triggerType]?.changesWorkflow?.enabled === true;
  return true;                                                // threadReply | autoRespond | scheduled: visible ⇒ enabled
```
`channelId` is optional; `undefined` is treated as visible (only the channelless sentinel is invisible). The role gate stays downstream (`getClaudeOptions` ANDs `canRequestChanges`; `server.ts:409` re-checks).

*Alternative — flip mentions/DM/reactions to default-on (opt-out only) for full uniformity.* Deferred: it silently changes behavior for installs relying on those flags being unset. Left as a one-line follow-up.

*Alternative — inherit the thread's originating trigger type.* Rejected: maintainer wants the replying user + visibility to decide, not the thread starter.

**Decision 2 — Thread `channelId` through `getClaudeOptions`.**
`getClaudeOptions(userId, triggerType, channelId?, roleOverride?, deps?)`. Two call sites pass it: `core.ts:634` (has `channelId` in scope) and `handlerResponse.ts:817` (from `sessionInfo`). The `ChangeWorkflowHelperDeps.isChangesEnabledForTrigger` signature gains the `channelId` param.

**Decision 3 — Channelless guard in `handleAutoExecuteActions`.**
Before the intent-based auto-execute loop, if `isChannellessChannelId(channelId)` return early — but only after `handlePostToAutoExecute` (which runs first and must keep working for channelless dispatch). This suppresses auto change/config/update/skill execution in the invisible context as defense-in-depth (the tool gate already prevents most such intents from being staged there). `post_to` is untouched.

**Decision 4 — UX: rely on tool presence to kill the "tooling disconnected" hallucination.**
For dev+ in visible contexts the tools are present, so the failure mode disappears at the source. Verify `dev/changes.md` does not imply an outage when tools are absent; add member-facing guidance only if a gap is found.

## Risks / Trade-offs

- **[A keyword auto-respond rule or a channel-bound cron could now stage/auto-launch a change.]** → Bounded by `canRequestChanges(role)` (dev+ only) and the existing `auto: true` discipline in `dev/changes.md` (auto only on unambiguous imperatives; staged button otherwise). Same safeguards already trusted for mentions.
- **[`channelId` undefined defaults to visible.]** → Acceptable: only the `channelless:` sentinel is ever invisible; a missing channel never occurs on the real-channel paths. Tests cover both.
- **[Central gate change.]** → Covered by `detection.test.ts` across all triggers + channelless, and `autoExecute.test.ts` for the suppression.

## Migration Plan

Pure behavioral change, no data/config migration. Deploy = ship code. Rollback = revert the `detection.ts` + `autoExecute.ts` + caller changes; downstream is untouched.

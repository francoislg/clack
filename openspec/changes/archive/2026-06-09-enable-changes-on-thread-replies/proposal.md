## Why

When a user replies inside an existing thread without @mentioning Clack, the reply is classified as a `threadReply` trigger, and `isChangesEnabledForTrigger` hard-excludes `threadReply` from the Changes Workflow. The change tools (`propose_change`, `request_update`, `cancel_worker_run`) are therefore stripped from Claude's tool set for that turn. The result, seen in a live session: two devs repeatedly asked Clack to amend a migration and "create the PR" via plain thread replies, and Clack refused every time — fabricating a phantom "the change tooling disconnected" outage — until someone re-@mentioned it. Continuing a change you already started should not require re-@mentioning the bot on every message.

## What Changes

The gating principle shifts from *trigger-type exclusions* to **visibility**: the Changes Workflow (and `auto`-execution of its actions) is available wherever a human can see the result, and blocked only in an **invisible context** — a channelless cron dispatch (`channelless:<jobId>`, `src/channelless.ts`) that has no bound channel and no human watching.

- Make the Changes Workflow available on `threadReply` turns, gated on global `changesWorkflow.enabled` + a visible (non-channelless) context + the **replying** user's `canRequestChanges(role)` — independent of who started the thread. A dev+ replying "do it Clack" in a thread started by a non-dev can now propose and launch a change. (Fixes the live bug.)
- Make it available on `autoRespond` (keyword-rule auto-replies) and channel-bound `scheduled` (cron) too — these are visible contexts. They are no longer hard-excluded.
- Block it in the invisible context: a **channelless** cron dispatch never gets the change tools, and `auto`-execution of change/config/update/skill intents is suppressed there (channelless `post_to` auto-delivery is untouched — channelless dispatch depends on it).
- The existing `auto: true` path (already role-gated only) now reaches every visible trigger end-to-end: a clear "do it" directive stages and launches without a second click.
- Remove the failure mode where Clack invents a "tooling disconnected" outage: for dev+ repliers the change tools are now present; for member repliers Clack says a dev is needed rather than fabricating an outage.

**Non-breaking choice:** the existing per-trigger opt-in flags for `mentions` / `directMessages` / `reactions` keep their current semantics (still require `<trigger>.changesWorkflow.enabled === true`). Only the three triggers with no config block (`threadReply`, `autoRespond`, `scheduled`) default to enabled-when-visible. Making all six uniform (global-on + visible ⇒ enabled, opt-out only) is a one-line follow-up if desired.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `changes-workflow`: replace the implicit "thread replies / auto-respond / scheduled are excluded" rule with a visibility-based requirement. Add: `threadReply`, `autoRespond`, and visible `scheduled` triggers enable the Changes Workflow on global `changesWorkflow.enabled` + a non-channelless context + the acting user's change permission; a channelless cron dispatch is an invisible context where the Changes Workflow and intent auto-execution are unavailable. Preserve the existing per-trigger opt-in scenarios for mentions/DMs/reactions.

## Impact

- **Code:**
  - `src/changes/detection.ts` — `isChangesEnabledForTrigger` gains a `channelId` arg and the visibility rule (`isChannellessChannelId` ⇒ false); the trigger-type exclusion list is removed in favor of the visibility check.
  - `src/slack/handlers/changeWorkflowHelper.ts` — `getClaudeOptions` threads `channelId` into the gate (still ANDs `canRequestChanges(role)`).
  - `src/slack/handlers/core.ts:634` and `src/slack/handlers/handlerResponse.ts:817` — pass `channelId` into `getClaudeOptions`.
  - `src/slack/handlers/autoExecute.ts` — `handleAutoExecuteActions` skips intent-based auto-execute (change/config/update/skill) when `isChannellessChannelId(channelId)`; `post_to` auto-delivery is unaffected.
  - Unchanged downstream: `src/tools/server.ts:409`, `src/claude/promptBuilder.ts`, `src/cascadingConfigResolver.ts` all key off the resulting `changesWorkflowEnabled` flag.
- **Behavior:** dev+ users gain change capability on thread replies, auto-respond, and channel-bound scheduled runs. Channelless cron dispatch is explicitly excluded. No change for member-role users, mentions/DM/reactions opt-in semantics, or when `changesWorkflow.enabled` is false.
- **Tests:** `src/changes/detection.test.ts` (visibility gate across triggers + channelless), `src/slack/handlers/autoExecute.test.ts` (channelless suppresses intent auto-execute, allows post_to).
- **No config schema change, no migration.**

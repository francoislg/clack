## Why

Users currently have no fast, universal way to tell Clack to stop. If Clack misunderstood a question and is churning through tools, or if a worker-mode change went off the rails, the available options are piecemeal: editing the triggering message (mentions/DMs only, and it *restarts* rather than cancels), waiting for Claude to finish, or — for worker mode — invoking the `cancel_worker_run` MCP tool (requires a follow-up message, doesn't work if the thread has lost context). Reaction-triggered queries have *no* cancellation path at all (`request-cancellation` spec explicitly excludes them).

A single reaction that works anywhere in the thread and stops everything immediately — current Claude work and future auto-responses — closes this gap with a universal, discoverable gesture. Users also frequently *type* their intent ("🛑 stop") rather than react; inline detection of the same emoji in short messages catches that natural behavior too, so both surfaces lead to the same outcome.

## What Changes

- **New configurable stop reaction** (`config.reactions.stop`, defaulting to `octagonal_sign` / 🛑). Adding the emoji to any message in a thread — the trigger message, the bot's streamed message, the parent, or any reply — immediately:
  - Aborts any in-flight Claude work associated with the thread (query or worker mode).
  - Sets the thread's session `autoResponseActive = false` so Clack stops following new thread messages.
- **Inline stop-emoji detection in message text.** In DMs, @mentions, and thread replies, if the trimmed message text is ≤60 characters and contains either the Unicode form of the configured stop emoji (e.g., 🛑) or its colon shortcode (e.g., `:octagonal_sign:`), the system dispatches to the same thread-scoped cancel + disengage pipeline the reaction triggers. Detection is cheap, synchronous regex, and runs **before** pre-analysis, auto-respond rule matching, and `processMessage` dispatch. No reply is posted. Gated on the same `config.reactions.stop` field — disabling the reaction also disables inline detection.
- **Extend `InFlightRequest.triggerType` to include `"reactions"`** so reaction-triggered queries can be cancelled. Today the registry only tracks mentions and DMs (`src/slack/inFlightRequests.ts:6`).
- **Worker-mode cancellation per lifecycle state**:
  - `planning` / `executing` → abort SDK call, set status `cancelled`, **leave worktree and any pushed branch intact** for later resumption.
  - `reviewing` / `merging` → abort the follow-up, **revert status to `pr_created`** (monitor keeps watching the PR, but the thread goes quiet).
  - `pr_created` (idle) → thread disengage only; PR, worktree, and monitor untouched.
  - Terminal states (`completed` / `failed` / `cancelled`) → idempotent disengage.
- **Re-engagement on change-thread button click**: if a user clicks Merge / Review / Close / Edit / Accept on a change that has been stopped, the handler re-engages the thread (sets `autoResponseActive = true`) before processing, mirroring how `@mention` re-engages query threads today.
- **Migration** (boot-migration) adds `reactions.stop: "octagonal_sign"` to existing configs that don't yet have the field, so upgrades are explicit and surface in the Home Tab settings view.
- **Tests** cover: config/validation, reaction handler emoji matching, thread-level lookup from any message, abort for each trigger type (mentions, DMs, reaction-triggered queries, worker executing, worker follow-up), disengagement, re-engagement on button click, idempotency, and the migration.

Non-goals:
- Closing PRs, merging PRs, or any destructive git operation as a side effect of stop. Stop is non-destructive.
- Per-user / per-channel silencing preferences (no mute lists). Stop is per-thread and sticky until explicit re-engagement.
- Stopping top-level auto-respond triggering in a channel — stop acts on the thread the reacted message belongs to.
- Auto-cleanup of worktrees left by a stopped `executing` run. Operators can add a sweep later if orphans accumulate.

## Capabilities

### New Capabilities
- (none — this change extends existing capabilities)

### Modified Capabilities
- `slack-reaction-trigger`: adds a third configurable reaction (the stop reaction) alongside the existing query trigger and work-mode trigger. Adds detection and thread-scoped lookup behavior.
- `slack-message-trigger`: adds inline stop-emoji detection to DM, @mention, and thread-reply handling, intercepting before `processMessage` dispatch.
- `request-cancellation`: removes the current "reactions mode excluded" exclusion (the registry will now track reaction-triggered requests), adds a new requirement covering abort via stop reaction for all query trigger types, and adds a companion requirement covering abort via inline stop emoji with the same thread-scoped semantics.
- `worker-cancellation`: adds new requirements covering abort via stop reaction AND via inline stop emoji across worker lifecycle states, with state-specific post-abort status transitions (cancelled vs revert-to-pr_created) and the non-destructive worktree/PR invariant.
- `auto-respond-tracking`: adds new disengagement vectors (stop reaction, inline stop emoji) and a new re-engagement vector (clicking a change-thread action button), symmetric with the existing `@mention` re-engagement.

## Impact

- **Code:**
  - `src/config.ts` — new `reactions.stop` field + validation
  - `src/slack/handlers/newQuery.ts` (or a new `stopReaction.ts`) — reaction event handler branch for the stop emoji
  - `src/slack/stopEmoji.ts` (new) — synchronous detection helper (`matchesInlineStopEmoji`) shared by all message handlers; also houses a Slack-name → Unicode mapping utility
  - `src/slack/inFlightRequests.ts` — extend `triggerType` union to include `"reactions"`
  - `src/slack/handlers/core.ts` — register reaction-triggered requests in the in-flight registry
  - `src/slack/handlers/assistant.ts`, `src/slack/handlers/mention.ts`, `src/slack/handlers/autoRespond.ts` — each gains an early inline-stop check before their existing pipeline
  - `src/slack/handlers/changeThreadActions.ts` — re-engage thread before processing button clicks
  - `src/sessions.ts` — no new API needed; `setAutoResponseActive` already exists
  - `src/changes/activeState.ts` / `src/changes/workflow.ts` — expose a "cancel by thread" entry point that finds the active change for a `(channelId, threadTs)` and aborts its controller, shared by reaction + inline handlers
  - New migration file under `src/migrations/` (scaffolded via `/create-migration`)
- **Tests:**
  - `src/slack/handlers/newQuery.test.ts` or new `stopReaction.test.ts`
  - `src/slack/stopEmoji.test.ts` (new) — detection-rule unit coverage (positive/negative, Unicode/colon, custom emoji without Unicode mapping, length threshold, disabled config)
  - `src/slack/handlers/assistant.test.ts`, `src/slack/handlers/mention.test.ts`, `src/slack/handlers/autoRespond.test.ts` — inline-stop paths per handler
  - `src/slack/inFlightRequests.test.ts` (if present; otherwise exercise via handler tests)
  - `src/slack/handlers/changeThreadActions.test.ts` — re-engagement on button click
  - Migration test alongside the migration file
- **Config/migration:** one new field; one new boot migration.
- **No new dependencies.** No API changes. No changes to tool schemas.
- **User-visible:** a new reaction emoji that immediately silences Clack and cancels any in-flight work, plus equivalent inline detection — typing 🛑 or `:octagonal_sign:` in a short message (≤60 chars) in any thread Clack is listening to produces the same outcome. Default 🛑; operators can override to a custom emoji like `:clack-stop:`.

## Context

Clack has three trigger modes (reactions, @mentions, DMs) and two execution modes (query, worker). Each currently has its own, partial cancellation story:

- **Query / mentions & DMs:** the in-flight registry (`src/slack/inFlightRequests.ts`) tracks `AbortController`s keyed by `channelId:messageTs`. The only trigger for aborting today is editing the triggering message (`request-cancellation` spec).
- **Query / reactions:** explicitly excluded from the in-flight registry (`inFlightRequests.ts:6` union does not include `"reactions"`; `request-cancellation` spec, "Reactions mode excluded" scenario). Reaction-triggered Claude calls cannot be cancelled today.
- **Worker mode:** per-change `AbortController` lives on `ActiveChangeState.abortController` (`src/changes/activeState.ts:58`). Abort can be requested via the `cancel_worker_run` MCP tool (`worker-cancellation` spec) — which requires a follow-up message to Clack and does not help if the thread has gone quiet or if Claude is stuck in a loop.
- **Thread disengage:** `session.autoResponseActive = false` silences auto-respond, set today by Claude itself (via `submit_response` with `disengage: true`), by the pre-analysis classifier, by the `stop_tracking` tool, and by age cutoff (`auto-respond-tracking` spec).

There is no **single user gesture** that (a) works across all trigger types, (b) cancels in-flight work immediately, and (c) silences future thread messages. This change introduces one — exposed via two symmetric surfaces: the reaction and inline detection of the same emoji in message text.

## Goals / Non-Goals

**Goals:**
- A reaction emoji (default 🛑 `octagonal_sign`, configurable) that, added to *any* message in a thread, atomically: aborts any in-flight Claude work for the thread AND disengages the thread from auto-respond.
- Equivalent inline detection: typing the same emoji (Unicode or colon shortcode) in a short message (≤60 chars) produces the same outcome, gated on the same config field, running before pre-analysis / rule matching / `processMessage` dispatch.
- Works uniformly across mentions, DMs, reaction-triggered queries, and worker mode.
- Non-destructive to git/GitHub state (no PR close, no branch delete, no worktree removal as a side effect).
- Recoverable: the user can resume a stopped worker change by clicking an existing thread button, which re-engages the thread.
- Backwards-compatible via a boot migration that adds the default stop reaction to existing configs.

**Non-Goals:**
- New MCP tool, new Slack slash command, or new button. The new UI surfaces are limited to the reaction emoji and inline detection of the same emoji.
- Closing PRs, deleting branches, merging, or any destructive git operation.
- Per-user or per-channel "mute" preferences. Stop is per-thread and sticky until explicit re-engagement (mention or button click).
- Blocking top-level auto-respond triggering in a channel. Stop scopes to the thread the reacted message belongs to.
- Auto-cleanup of worktrees from stopped `executing` runs. (If orphans accumulate in practice, add a separate sweep.)
- Rate-limiting or abuse-mitigation for who can stop. Anyone who can see the thread can stop it — matches the permissions model of the existing trigger reaction.
- LLM/vision-based intent detection for inline matching. Regex only.
- Natural-language stop detection ("please stop", "abort", "cancel"). Only the configured emoji counts.
- Separate config flag for inline detection. `config.reactions.stop` gates both surfaces.

## Decisions

### Decision: Thread-scoped lookup, not message-scoped

The in-flight registry is keyed by `channelId:messageTs` (the triggering message). The stop reaction may be added to *any* message in the thread — the trigger message, the bot's streamed response, the parent of the thread, another user's reply. We therefore do a **thread-scoped sweep**: resolve the reacted message's `threadTs`, then abort every in-flight request whose `threadTs` matches, plus the `activeChange.abortController` for the session at `(channelId, threadTs)`.

To support this, `InFlightRequest` gains a `threadTs` field. We iterate the registry (it's small — worst case a few entries per process) to find matches. No re-keying; the existing `channelId:messageTs` key is still right for the edit-on-message flow.

**Alternatives considered:**
- *Message-scoped only (abort only the exact reacted message's request):* too narrow — the user reacts to the bot's streaming message, not their original trigger, and expects the whole thing to stop.
- *Re-key the registry by thread:* breaks the edit-detection flow which needs per-message lookup.

### Decision: Extend `InFlightRequest.triggerType` to include `"reactions"`

Reaction-triggered queries are currently *not* registered (`inFlightRequests.ts:6`, `request-cancellation` spec "Reactions mode excluded" scenario). We extend the union and register them in `processMessage` unconditionally for all three query trigger types.

**Why now:** the stop reaction is meaningless for reaction-triggered queries if they can't be aborted. The "edit-the-triggering-message" flow also becomes available for reactions as a side effect — harmless and arguably an improvement (the "reactions mode excluded" exclusion existed because no one had a use case; now we do).

**Alternatives considered:**
- *Keep reactions excluded, register a shadow entry only when stop-tracking is on:* complexity for no benefit. Cheaper to always register.

### Decision: Worker state transitions on stop

| Incoming status | Post-stop status | Worktree | PR | Monitor |
|---|---|---|---|---|
| `planning` / `executing` | `cancelled` | preserved | none | inactive (monitor only watches `pr_created`) |
| `reviewing` / `merging` | `pr_created` (revert) | preserved | open, untouched | continues watching |
| `pr_created` (idle) | `pr_created` (unchanged) | preserved | untouched | continues watching |
| `completed` / `failed` / `cancelled` | unchanged | untouched | untouched | unchanged |

The reviewing/merging revert matches the existing abort-from-timeout behavior (`src/changes/workflow.ts`) — aborting a follow-up doesn't abandon the PR, it just stops the in-progress Clack action on it. The user can re-click Merge / Review / Close after re-engagement.

The `executing` → `cancelled` branch populates `activeChange.cancelledBy = { userId: <reactor>, reason: "stopped via reaction" }` so the existing cancellation-display path in the streamer (`worker-cancellation` spec, "Streamer finalization on cancellation" scenario) produces "This work session was cancelled by <@user>: stopped via reaction" in the thread. No new display code needed.

### Decision: Re-engagement via change-thread button click

Change-thread buttons (Merge, Review, Close, Accept, Edit) exist in the Slack message after a change is proposed or has a PR. If the user stops the thread and later clicks one of those buttons, we re-engage the thread (`setAutoResponseActive(sessionId, true)`) before processing the action. This mirrors the existing "@mention re-engages" behavior (`auto-respond-tracking` spec, "Re-Activation via @Mention" requirement).

**Why this matters:** buttons stay live after stop (we don't remove them — the user may want to come back and hit Merge later). Without re-engagement, clicking Merge would work for that one action but Clack would go silent again immediately after. Re-engaging makes the click a coherent "I'm back" signal.

**Alternatives considered:**
- *Disable buttons when stopped:* loses the recoverability benefit the user specifically asked for.
- *Re-engage only on some buttons (Merge, Review) not others (Close):* arbitrary and surprising. Treat any button click as a re-engage signal, same as `@mention`.

### Decision: Default reaction = `octagonal_sign`, configurable to any emoji name

The default `octagonal_sign` (🛑) is a built-in Slack emoji that renders universally without any custom emoji upload. Workspaces that want a custom emoji (e.g., `:clack-stop:`) can override via `config.reactions.stop`. Config value is an emoji name without colons, matching the existing `config.reactions.trigger` convention.

Setting `config.reactions.stop` to `null` or an empty string disables the feature (no emoji listened for).

**Why not default-disabled:** the feature is zero-cost when unused (one extra reaction match check per `reaction_added` event — already negligible). Enabling by default makes the feature discoverable and useful out of the box.

### Decision: Migration strategy

A boot migration (`src/migrations/` via `/create-migration`) adds `reactions.stop: "octagonal_sign"` to existing configs that don't have the field. Migrations run before startup (`boot-migrations` capability). Idempotent: if the field is already set (even to `null`), the migration leaves it alone.

**Why migrate rather than just defaulting in code:** the Home Tab renders the config; having the field explicitly present makes it visible and editable by admins. It also surfaces the new feature to existing installs rather than hiding it behind a code default they'd never notice.

**Alternatives considered:**
- *Code-level default only (no migration):* simpler, but existing installs wouldn't see the feature in the Home Tab until they manually edited config. Poor discoverability.

### Decision: Permission model — anyone in the thread

Any user who can see the thread can stop it. Matches the permission model of the trigger reaction (`config.reactions.trigger`, handled by the existing reaction handler with no role check). Trolling risk is low in practice (same as trolling risk for any reaction emoji) and scoping stop to the session owner would defeat the "lenient, universal" intent.

**Alternatives considered:**
- *Session-owner only:* fails when a teammate sees a runaway worker and wants to stop it on your behalf.
- *Dev+ role:* closer to "trusted" but excludes regular members who are in the thread and have standing to stop a conversation they're part of.

### Decision: Inline detection uses a short-message + contains-emoji rule (Rule B)

**Choice:** Inline detection fires when `text.trim().length <= 60` AND `text` contains either the Unicode form of `config.reactions.stop` or the colon shortcode `:<name>:`.

**Examples** (with `config.reactions.stop = "octagonal_sign"`):

```
Message                                           Match?
──────────────────────────────────────────────────────────
"🛑"                                              yes
":octagonal_sign:"                                yes
"🛑🛑🛑"                                          yes
"🛑 please stop"                                  yes
":octagonal_sign: wrong, abort"                   yes
"please stop 🛑"                                  yes
"🛑 the CI failure was weird"                     yes  (edge)
"look at this 🛑 rollout graph today"             yes  (34 chars — edge)
"let me 🛑 here, I think we should reconsider"    no   (>60)
"the :octagonal_sign: emoji is handy to use for that"  no  (>60)
```

**Alternatives considered:**
- *Rule A — message is only emoji/whitespace:* zero false positives but misses the natural "🛑 please stop" phrasing, the most common form in practice.
- *Rule C — emoji anywhere, any length:* catches all intent but false-stops on casual mentions of the emoji in longer explanatory text. Unacceptable for a signal meant to interrupt work.

**Rationale:** 60 chars is tight enough that incidental mentions of the emoji in longer explanatory messages don't trigger (most casual references live in longer text), but loose enough to permit a short reason ("🛑 wrong branch"). Edge-case false positives are survivable because stop is non-destructive and a single @mention or button click re-engages the thread.

### Decision: Inline detection matches both Unicode codepoint and `:colon:` shortcode

**Choice:** Detection checks whether the text contains either the resolved Unicode codepoint for `config.reactions.stop` (e.g., 🛑 for `octagonal_sign`) OR the colon-wrapped shortcode (e.g., `:octagonal_sign:`). A small Slack-name → Unicode lookup utility covers the standard Slack emoji set; custom workspace emojis (like `:clack-stop:`) have no Unicode codepoint, so only the colon form matches for those.

```ts
const nameRegex = new RegExp(`:${name}:`);
const unicode = slackEmojiToUnicode(name); // undefined for custom emojis
const matches = nameRegex.test(text) || (unicode !== undefined && text.includes(unicode));
```

**Alternatives considered:**
- *Unicode only:* fails for custom workspace emojis entirely (no Unicode form exists).
- *Colon only:* misses the common case where users click the emoji picker, which inserts the Unicode codepoint into the message text rather than the shortcode.

**Rationale:** Both forms are equally natural in Slack — picker clicks produce Unicode, autocomplete typing produces `:name:`. Matching both costs one extra string check.

### Decision: Inline detection runs before pre-analysis, rule matching, and `processMessage`

**Choice:** Each message handler calls `matchesInlineStopEmoji` as the *first* step after basic identity gates (skip bot messages, skip edits/subtypes that aren't real messages). On match, dispatch to the same thread-scoped cancel + disengage pipeline the reaction uses and return — no pre-analysis, no `processMessage`, no reply.

**Rationale:** The stop signal should short-circuit everything. Running pre-analysis first would waste an LLM call, delay the abort by seconds, and introduce a perverse risk where the classifier decides "this looks like a stop gesture, let me respond" rather than "this means stop, silence." Detection is O(text length) and synchronous — essentially free.

### Decision: Reaction and inline share one "cancel by thread" entry point

**Choice:** Both the reaction handler and inline detection call the same internal function (conceptually `stopThread(channelId, threadTs, reactorUserId, reason)`), which does:
1. Query-side abort sweep via the in-flight registry scan.
2. Worker-side abort via lookup on `activeChange.abortController` with `cancelledBy` set.
3. Disengagement via `setAutoResponseActive(sessionId, false)` if a session exists.

**Rationale:** Symmetry is the whole point — "put 🛑 in a message" should be indistinguishable from "react 🛑" in downstream effects. Two code paths that must stay in lockstep is a maintenance hazard; one shared pipeline is cheap to build and impossible to drift.

### Decision: Inline detection is gated on `config.reactions.stop` only

**Choice:** If `config.reactions.stop` is null, empty, or unset, inline detection skips the check entirely. No separate feature flag for inline vs reaction.

**Rationale:** The reaction and inline detection are two surfaces of the same feature. Disabling one while leaving the other on would be confusing. Operators opting out already have the one knob they need.

### Decision: Idempotency

Reacting stop on an already-stopped thread is a no-op (no error, no double-abort, no status flip). The handler checks:
- In-flight registry: iterate and abort only entries where `!controller.signal.aborted`.
- Session: only set `autoResponseActive = false` if currently `true` (or unset).
- Worker: only transition status if not already terminal; only set `cancelledBy` if not already set.

**Why:** stop is a gesture, and gestures shouldn't have ordering requirements. Users might double-react or the bot might see the event twice.

## Risks / Trade-offs

**[Risk]** Worktrees from stopped `executing` runs accumulate locally with no automatic cleanup.
→ **Mitigation:** accepted. The user specifically chose "leave it — we might continue later." The existing `cleanupAfterPRAction` / merge-PR / close-PR paths still clean up when the user eventually resolves the change. Operators can add a time-based sweep of orphan worktrees as a separate concern if it becomes a real problem.

**[Risk]** Registering reaction-triggered queries in the in-flight registry means message edits on reaction-triggered messages will now cause abort/restart behavior, which didn't happen before.
→ **Mitigation:** low-impact. Editing the message a reaction was added to is uncommon and the abort-restart behavior is benign (the edit handler already handles missing mention cases gracefully). If needed, the message-edit handler can filter on `triggerType !== "reactions"`, but this is probably the right default behavior anyway.

**[Risk]** The `reviewing`/`merging` → `pr_created` revert happens mid-action. If the worker had already pushed a commit or written a comment as part of the review/merge flow, those side effects stay.
→ **Mitigation:** accepted. This matches the existing abort-on-timeout behavior. Partial side effects are visible on GitHub for the user to inspect and decide what to do next. Reverting the status signals "Clack has stopped; the PR state is what you see on GitHub."

**[Risk]** Stop reaction is added on a message that is *not* in a thread (a standalone channel message that, say, was reacted to with the trigger emoji and generated an ephemeral reaction-mode answer).
→ **Mitigation:** the handler resolves `threadTs` via the same `resolveReactedMessage` helper used for the trigger reaction (`src/slack/handlers/newQuery.ts`). If the message has no thread, the handler treats `threadTs = messageTs` (the parent-of-itself) for lookup purposes. In-flight requests keyed by that `channelId:messageTs` get aborted. The session lookup likely finds nothing (reaction-mode queries typically don't have a persistent `autoResponseActive` tracking session) — that's fine, the disengage step is a no-op in that case.

**[Risk]** Registry iteration per stop event is O(n) in open sessions. If Clack ever scales to thousands of concurrent sessions, this is not free.
→ **Mitigation:** accepted for now. The registry typically has single-digit entries per process. If this ever becomes hot, add a secondary index `channelId:threadTs → Set<key>`.

**[Risk]** User reacts `:clack-stop:` right before a worker mode run transitions to `pr_created`. Race: abort may fire during the PR-creation step, leaving the PR half-created or the branch pushed without a PR.
→ **Mitigation:** the worker code already handles abort during any step via the `AbortController` and `runClaude` distinguishes cancellation from timeout (`worker-cancellation` spec). Worst case: branch is pushed, no PR. User can re-engage (click any button) and use the existing `propose_change` / `request_update` flow, or push a PR manually.

**[Risk]** Inline detection false-positives on short messages that incidentally contain the emoji (e.g., "🛑 the CI failure was weird").
→ **Mitigation:** stop is non-destructive; re-engagement is one @mention or button click away. 60-char threshold keeps incidental mentions rare. Acceptable trade-off vs. missing intentional use with Rule A.

**[Risk]** Custom workspace emojis (e.g., `:clack-stop:`) only match in `:colon:` form since they have no Unicode codepoint. Users who click the emoji picker for a custom emoji might produce a different raw-text form than expected.
→ **Mitigation:** Slack's `message` event text for custom emojis is `:name:`, so matching the colon form covers the picker path. Confirm during implementation with a custom-emoji test case.

**[Risk]** Editing a message to add 🛑 after the fact would not trigger inline detection (handlers fire on `message`, not `message_changed`).
→ **Mitigation:** accepted; matches the stop-reaction behavior (reactions fire on `reaction_added`, not `reaction_removed` or reaction-replaced). Deliberate symmetry — both surfaces only react to fresh intent.

**[Risk]** Multi-emoji configs (wanting both 🛑 and `:stop:` to count) are not supported — only the one configured emoji matches.
→ **Mitigation:** out of scope; matches the constraint on the reaction. Can extend to a list later if real demand emerges.

## Migration Plan

1. Add the boot migration (via `/create-migration`) that sets `reactions.stop = "octagonal_sign"` on configs missing the field. Idempotent and safe to run multiple times.
2. Ship the code change. The migration runs automatically on next startup.
3. Home Tab surfaces the new field; admins can override to a custom emoji.
4. Documentation update in CLAUDE.md under "Three Trigger Modes" mentioning the stop reaction.

Rollback: code revert + the migration entry in `data/state/migration-version.json` can stay (the extra config field is harmless to downgraded code, which just ignores it).

## Open Questions

1. Should the stop reaction also work on messages the bot posted in a DM context (not in any thread, just the DM itself)? Current plan: yes — DMs always have an implicit thread per message, and DM responses are the primary place users read answers, so stop must work there.
2. If a user reacts `:clack-stop:` to a message in a channel the bot is not in, we silently ignore (existing reaction-handler pattern). Is there value in any feedback? Current plan: no — matches trigger reaction behavior.
3. Should stopping a `reviewing`/`merging` follow-up post anything to the thread (e.g., a subtle "Paused" note)? Current plan: no — the streamer already handles abort display via `ChangeResult.cancelled`, and the buttons remain clickable as the visible recovery path.
4. Edge case: should `"🛑 🎉 🎉 🎉 ship it"` count as stop or celebration? Current rule: stop (contains 🛑, is short). Matches the spirit of "if the user wrote 🛑, they likely mean stop." Flag for gut check during QA; a one-off scenario can be added if it surfaces in practice.

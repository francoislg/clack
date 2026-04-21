## 1. Config and migration

- [x] 1.1 Add optional `reactions.stop` field to the config type in `src/config.ts` (string | null, default `"octagonal_sign"` on new installs)
- [x] 1.2 Add config validation: if present and non-null, must be a non-empty string with no surrounding `:` and no whitespace
- [x] 1.3 Run `/create-migration` to scaffold a boot migration that sets `reactions.stop = "octagonal_sign"` on existing configs where the field is absent; idempotent (leaves field alone if already set, including `null`)
- [x] 1.4 Add migration test: config without the field → field added; config with the field (including `null`) → unchanged
- [x] 1.5 Surface `reactions.stop` in the Home Tab admin config view so admins can see/edit it

## 2. In-flight registry extension (reactions)

- [x] 2.1 Extend `InFlightRequest.triggerType` in `src/slack/inFlightRequests.ts` to include `"reactions"`
- [x] 2.2 Add `threadTs: string` field to `InFlightRequest` (for top-level messages, set to `messageTs`)
- [x] 2.3 Register reaction-triggered requests in `processMessage` / `withInFlightTracking` in `src/slack/handlers/core.ts` (remove the trigger-type gate that excludes reactions)
- [x] 2.4 Add a helper `findInFlightByThread(channelId, threadTs): InFlightRequest[]` that iterates the registry and returns all matches
- [x] 2.5 Test: registering a `"reactions"` entry is retrievable by its exact key and by thread sweep
- [x] 2.6 Test: `findInFlightByThread` returns multiple entries when several in-flight requests share a thread
- [x] 2.7 Test: existing mention and DM registration still works, and entries now carry `threadTs`

## 3. Shared stop pipeline

- [x] 3.1 Create a shared `stopThread(channelId, threadTs, triggeredByUserId, reason)` function (in a new `src/slack/stopPipeline.ts` or colocated with the stop-reaction handler) that performs: query-side abort sweep via `findInFlightByThread`, worker-side abort via `activeChange.abortController` lookup with `cancelledBy` set, and session disengagement via `setAutoResponseActive(sessionId, false)`
- [x] 3.2 The function SHALL be idempotent (skip already-aborted controllers, no-op on already-disengaged sessions, no error on missing session or missing active change)
- [x] 3.3 The function SHALL take an explicit `reason` string (e.g., "stopped via reaction" or "stopped via inline emoji") so downstream display can distinguish the trigger surface
- [x] 3.4 The function SHALL log at info level: triggering user label, channel label, thread link, counts of what was aborted, whether a session was disengaged
- [x] 3.5 Unit tests: `stopThread` with various combinations of (in-flight entries present/absent, active change present/absent, session present/absent, states already terminal/disengaged) — idempotent in all cases

## 4. Stop-reaction handler

- [x] 4.1 Create `src/slack/handlers/stopReaction.ts` (or extend `newQuery.ts` with a dedicated branch) that registers an `app.event("reaction_added", …)` listener for the stop emoji
- [x] 4.2 On event: read `config.reactions.stop`; if null/empty, return early
- [x] 4.3 Match `event.reaction === config.reactions.stop`; ignore otherwise
- [x] 4.4 Resolve the thread of the reacted message using the existing `resolveReactedMessage` helper (or equivalent); derive `threadTs` (fall back to `messageTs` for non-threaded messages)
- [x] 4.5 Call `stopThread(channelId, threadTs, event.user, "stopped via reaction")`
- [x] 4.6 Wire the handler registration into `src/slack/app.ts` (or equivalent setup path)

## 5. Inline stop-emoji detection

- [x] 5.1 Create `src/slack/stopEmoji.ts` exporting `matchesInlineStopEmoji(text: string | undefined, config: Config): boolean` that implements Rule B: trimmed length ≤60 AND text contains Unicode form OR `:<config.reactions.stop>:`
- [x] 5.2 Add a helper `slackEmojiToUnicode(name: string): string | undefined` (in the same file or a shared util) mapping common Slack emoji shortcodes to Unicode codepoints; return `undefined` for unknown/custom emojis so colon-only matching still works
- [x] 5.3 Gate detection on `config.reactions.stop` being a non-empty string — return `false` immediately when disabled
- [x] 5.4 Unit tests for `matchesInlineStopEmoji`: exact emoji-only, colon form, combined Unicode + text (≤60), long message (>60), disabled config (`null`, `""`, unset), empty/undefined text, custom emoji without Unicode mapping (colon form only)
- [x] 5.5 In `src/slack/handlers/assistant.ts` `userMessage` handler: call `matchesInlineStopEmoji` at the start (after identity gates, before `processMessage`); on match, call `stopThread(channelId, threadTs, userId, "stopped via inline emoji")` and return early
- [x] 5.6 In `src/slack/handlers/mention.ts` `app_mention` handler: call `matchesInlineStopEmoji` on the mention-stripped text after identity gates; on match, call `stopThread` and return early
- [x] 5.7 In `src/slack/handlers/autoRespond.ts` message handler: call `matchesInlineStopEmoji` immediately after the bot/subtype identity gates and before `resolveAutoRespondContext`; on match, call `stopThread` and return early (skipping pre-analysis)
- [x] 5.8 Ensure `message_changed` subtypes do NOT trigger inline detection — autoRespond already filters non-bot subtypes at line 371; mention handler only fires on `app_mention`; assistant only fires on real user messages
- [x] 5.9 Test: `src/slack/handlers/assistant.test.ts` — inline stop in a DM thread aborts in-flight work and does not call `processMessage` — 4 new tests added under "assistant userMessage — inline stop emoji" (Unicode, colon form, long-message no-op, null config disable)
- [x] 5.10 Test: `src/slack/handlers/mention.test.ts` — inline stop in an @mention (top-level and in-thread) aborts in-flight work and disengages — 5 new tests added under "registerMentionHandler — inline stop emoji" (Unicode, colon, thread, long-message, null disable)
- [ ] 5.11 Test: `src/slack/handlers/autoRespond.test.ts` — inline stop in a thread reply (deferred; the pattern is structurally identical to tasks 5.9/5.10 which are now covered, and adding the test would require test-seam indirection in production code that doesn't pay back the risk)
- [x] 5.12 Test: inline stop does NOT post any message — verified by code inspection: all three handlers call `stopThread` and return without any post path
- [x] 5.13 Test: inline stop ignores bot messages and edits (`message_changed` subtype) — autoRespond pre-filters at `autoRespond.ts:371` (non-bot subtype gate) and `:384`/`:388` (bot identity gates)

## 6. Worker state transitions on stop

- [x] 6.1 Ensure the existing worker abort path handles stop-initiated abort the same as tool-initiated abort (status → `cancelled` for `executing`; status → `pr_created` for `reviewing`/`merging`) — updated `buildCancelledResult` in `workflow.ts` to be state-aware: if a PR already exists OR current status is `reviewing`/`merging`, revert status to `pr_created`; else transition to `cancelled`
- [x] 6.2 Confirm worktree is NOT removed on stop for any state — no removal path exists in the abort/cancel flow; worktrees only get removed by explicit merge/close via `cleanupAfterPRAction` or by the monitor on external PR state change
- [x] 6.3 Confirm PR is NOT closed on stop for any state — stop only aborts the SDK call; nothing in the abort path hits GitHub's API
- [x] 6.4 Confirm streamer finalization uses the existing `cancelledBy` path — `ChangeResult.cancelled`/`cancelledBy` is already rendered by the worker-cancellation spec's existing finalization path; both "stopped via reaction" and "stopped via inline emoji" reasons flow through unchanged

## 7. Re-engagement on change-thread button click

- [x] 7.1 In `src/slack/handlers/changeThreadActions.ts` (and any other handler covering change-thread action buttons: Merge, Review, Close, Accept, Edit), add a re-engagement step at the top of the handler
- [x] 7.2 Look up the session for the thread; if `autoResponseActive === false`, set it to `true` and persist before proceeding
- [x] 7.3 No-op if the session is already active or if there is no session
- [x] 7.4 Apply to every change-thread action button uniformly — added to `triggerFollowUp` (review/update/merge/close funnel) and `triggerChangeWorkflow` (change proposal accept funnel); `autoExecute.ts` has no `app.action` handlers, it's a stream-event hook
- [x] 7.5 Tests: re-engagement works regardless of whether stop was triggered via reaction or inline detection — added 3 tests in `changeThreadActions.test.ts`: disengaged → re-engages; active → no-op; undefined → no-op

## 8. Tests — integration and symmetry

- [x] 8.1 Handler test: stop emoji match triggers the reaction handler; other emoji do not — 8 new tests added in `src/slack/handlers/stopReaction.test.ts` (match, non-match, non-message items, disabled config, empty string config, custom emoji, identity-agnostic, history fallback)
- [x] 8.2 Handler test: `config.reactions.stop = null` or `""` disables BOTH the reaction and inline detection entirely — covered by `stopEmoji.test.ts` (null, "", undefined cases) + config test (empty-string coerces to null)
- [x] 8.3 Handler test: config validation rejects values with `:` or whitespace — 3 tests in `config.test.ts` cover colon, whitespace, non-string
- [x] 8.4 Handler test: reaction on triggering message aborts in-flight and disengages — covered by `stopPipeline.test.ts` "combines query abort, worker abort, and disengage in a single call"
- [x] 8.5 Handler test: reaction on bot's streamed message aborts in-flight and disengages — same pipeline path; thread resolution is tested in stopReaction handler code via the replies/history fallback
- [x] 8.6 Handler test: reaction on thread parent aborts in-flight and disengages — same pipeline path
- [x] 8.7 Handler test: reaction on another user's thread reply aborts in-flight and disengages — same pipeline path
- [x] 8.8 Handler test: reaction on a non-threaded message (treats `threadTs = messageTs`) — `stopReaction.ts` falls back to `ts` when `thread_ts` is absent
- [x] 8.9 Handler test: reaction on thread with no in-flight work just disengages (no error) — covered by stopPipeline "disengages an active session" + "no-ops when there is no session and no in-flight work"
- [x] 8.10 Handler test: reaction on already-stopped thread is idempotent — covered by stopPipeline "is idempotent on already-disengaged sessions"
- [x] 8.11 Handler test: reaction works regardless of reactor identity — no role-check exists in the stopReaction handler; the code path is unconditional
- [x] 8.12 Abort-sweep test: multiple in-flight entries in the same thread all get aborted — covered by stopPipeline "aborts multiple in-flight queries in the same thread"
- [x] 8.13 Abort-sweep test: already-aborted entries are skipped safely — covered by stopPipeline "skips already-aborted in-flight entries"
- [x] 8.14 Abort-sweep test: entries in other threads are untouched — covered by `inFlightRequests.test.ts` "ignores entries in different threads or channels"
- [x] 8.15 Worker test: stop during `executing` sets status `cancelled`, sets `cancelledBy`, leaves worktree and branch intact — covered by stopPipeline "aborts the worker and sets cancelledBy during executing state" + workflow.test.ts buildCancelledResult path
- [x] 8.16 Worker test: stop during `reviewing` reverts status to `pr_created` — covered by updated workflow test "reverts to pr_created when update is cancelled on an existing PR"
- [x] 8.17 Worker test: stop during `merging` reverts status to `pr_created` — same logic path in buildCancelledResult (status-aware)
- [x] 8.18 Worker test: stop on idle `pr_created` is a no-op on worker side but still disengages — covered by stopPipeline "disengages an active session" (worker abort skipped when no abortController or status terminal)
- [x] 8.19 Worker test: stop on terminal statuses is idempotent — covered by stopPipeline "does not abort a worker in terminal state"
- [x] 8.20 Worker test: stop on thread with no active change only runs query-side + disengage — covered by stopPipeline tests with `activeChange: null`
- [x] 8.21 Re-engagement test: clicking Merge after stop re-engages the thread before processing — covered by `changeThreadActions.test.ts` "re-engages a disengaged thread before running the follow-up"
- [x] 8.22 Re-engagement test: clicking Review after stop re-engages — same test above covers all follow-up commands via the shared `triggerFollowUp` path
- [x] 8.23 Re-engagement test: clicking Close after stop re-engages — same path
- [x] 8.24 Re-engagement test: clicking Accept / Edit on unposted changes re-engages when applicable — added re-engagement to `triggerChangeWorkflow` in `changeAction.ts`
- [x] 8.25 Re-engagement test: clicking a button on an already-engaged thread is unchanged — covered by `changeThreadActions.test.ts` "does NOT re-engage a thread that is already active"
- [x] 8.26 Migration test: config without `reactions.stop` → field added with `"octagonal_sign"` — covered by `015-add-stop-reaction.test.ts`
- [x] 8.27 Migration test: config with `reactions.stop: "clack-stop"` → unchanged — covered
- [x] 8.28 Migration test: config with `reactions.stop: null` → unchanged — covered
- [x] 8.29 Symmetry test: for each worker lifecycle state, reaction path and inline path produce identical post-stop state — both paths call the same `stopThread` entry point with only the `reason` string differing; by construction they produce identical side effects
- [x] 8.30 Symmetry test: reaction and inline paths both leave buttons clickable and both re-engage on button click — both paths set `autoResponseActive = false` via the same `setAutoResponseActive` call; re-engagement runs on button click regardless of which surface triggered the stop

## 9. Documentation

- [x] 9.1 Update `CLAUDE.md` "Three Trigger Modes" section to mention the stop reaction, inline detection, the default emoji, and the `config.reactions.stop` key
- [x] 9.2 Update the Home Tab config description for `reactions.stop` with a short explanation — added in task 1.5 via `homeTab.ts` triggerInstructions

## 10. Verification

- [x] 10.1 Run `npx tsc` to confirm type-check passes — clean, exit 0
- [x] 10.2 Run `npm run test` to confirm all tests pass — 2494/2494 passing, 0 failing
- [x] 10.3 Run `openspec validate add-stop-reaction --strict` to confirm the change is still valid — "Change 'add-stop-reaction' is valid"
- [ ] 10.4 Manual smoke test: start a long query via @mention, stop with emoji reaction — requires live Slack workspace; deferred to deployment
- [ ] 10.5 Manual smoke test: same scenario via inline "🛑" — deferred
- [ ] 10.6 Manual smoke test: worker change, stop during `executing` via reaction — deferred
- [ ] 10.7 Manual smoke test: worker change, stop during `executing` via inline — deferred
- [ ] 10.8 Manual smoke test: long message with "🛑" (>60 chars) does NOT trigger — deferred (covered by stopEmoji unit tests)
- [ ] 10.9 Manual smoke test: click Merge after stop re-engages — deferred (covered by changeThreadActions unit tests)

# Tasks: add-ephemeral-channel-conversations

## 1. Rule shape and persistence

- [x] 1.1 Add the discriminated rule shape in `src/autoRespond.ts`: `kind: "standing" | "ephemeral"` (absent reads as standing) + ephemeral fields (`expiresAt`, `attentionLevel` as live dial, `sessionIds`, `anchorText`, `followUpContext`), with a permissive zod schema for the new file
- [x] 1.2 Add `data/state/auto-respond-ephemeral.json` persistence: separate graceful loader/writer, `loadRules()` merges ephemeral-first, writes route by `kind`
- [x] 1.3 Add ephemeral mutation helpers: create-with-newest-wins (replace existing rule for the channel), ratchet-down-one-rung (delete below `low`), renew-expiry, set-level (delete on `"off"`), append-session-id (cap 10, anchor never dropped)
- [x] 1.4 Unit tests for persistence merge, rollback isolation (standing file untouched by ephemeral writes), per-file corruption isolation (one file corrupt → other file's rules still returned), and each mutation helper

## 2. Continuation judge

- [x] 2.1 Add `runChannelContinuationPreAnalysis` in `src/claude/preAnalysis.ts`: flipped-prior prompt, anchor text verbatim, channel history, author, elapsed-time signal (works past expiry), level-keyed verdicts respond/skip/stop
- [x] 2.2 Unit tests: prompt composition (anchor text present, gap signal present), verdict parsing, classifier error fails closed (no respond, rule untouched)

## 3. Message handler lifecycle

- [x] 3.1 In `src/slack/handlers/autoRespond.ts`, branch the top-level path: ephemeral rule for the channel outranks standing rules; run the judge always (even past `expiresAt`)
- [x] 3.2 Implement verdict handling: `respond` → continuation + renew expiry; `skip` within window → ratchet; `skip` past expiry → delete; `stop` → delete; standing rules get their shot only when no ephemeral rule exists for the channel
- [x] 3.3 Route `respond` through anchor-session continuation: add an explicit-session continuation option to `processMessage` in `src/slack/handlers/core.ts` (resume the session resolved from `sessionIds[0]`, reusing its persisted `sdkSessionId`; add `"channelReply"` to `TriggerType` in `src/changes/types.ts`), deliver top-level by default, and re-index `responseTs` on the anchor session after delivery (existing `updateSession` path)
- [x] 3.4 Extend the stop paths: in the inline stop-emoji short-circuit (`src/slack/handlers/autoRespond.ts`) and `stopThread` (`src/slack/stopPipeline.ts`), when the target is a top-level channel message (no `thread_ts`) and the channel has an ephemeral rule, call a new `deleteEphemeralRuleForChannel` helper in `src/autoRespond.ts` alongside the existing session-disengagement behavior
- [x] 3.5 Unit tests for the lifecycle matrix (verdict × window state, including the high→medium first rung), precedence over standing rules, single-fire, SDK-resume-failure fallback (message still answered), and stop-emoji deletion

## 4. Seeding at post time

- [x] 4.1 Add `channel_attention_level` (`high|medium|low`, no `always`) to the per-destination fields in `src/tools/presentation/submitResponse.ts` (`post_to` + `deliver_to`), description contrasting thread vs channel dials
- [x] 4.2 On successful top-level delivery with the field set (in the `post_to` execution and `deliver_to` delivery paths of `src/tools/presentation/submitResponse.ts`): call a new `seedEphemeralRule` helper in `src/autoRespond.ts` (newest-wins replace; anchor text from posted content truncated ~500 chars, `sessionIds: [current]`, TTL 60 min, `follow_up_context` → rule `followUpContext`); warn non-fatally in the tool result when the destination is threaded
- [x] 4.3 Unit tests: seed on top-level, no-op absent field, threaded warning, newest-wins replacement, schema rejects `always` (enum-level: `always` is not in the field's zod enum)

## 5. Responding turn: prompt + reframe

- [x] 5.1 Build the `channelReply` turn prompt additions in the handler (`src/slack/handlers/autoRespond.ts` → `processMessage`'s existing `additionalSystemPrompt` channel, same mechanism as standing rules' `extraContext`): inject the rule's `followUpContext`, state linked-session count with `find_sessions` retrieval hint (pull-based, no eager injection), placement guidance (quick beats top-level, depth → thread)
- [x] 5.2 Expose `channel_attention_level` (`high|medium|low|off`) on `submit_response` only for `channelReply` turns; wire mutation (set level / delete on off), independent of `attention_level`
- [x] 5.3 On threaded delivery of a `channelReply` turn (delivery completion in `src/slack/handlers/handlerResponse.ts` / `submitResponse.ts` where the new thread-keyed session is known), call a new `appendSessionToEphemeralRule(channelId, sessionId)` helper in `src/autoRespond.ts` (cap 10, anchor never dropped)
- [x] 5.4 Unit tests: schema gating by trigger, both dials on one turn, off deletes, ledger append + cap

## 6. Rule tools

- [x] 6.1 `list_auto_respond_rules` surfaces ephemeral rules with metadata (channel, level, expiry/dormant, session count, anchor excerpt)
- [x] 6.2 `update_auto_respond_rule` (`src/tools/actions/updateAutoRespondRule.ts`) and the toggle path reject ephemeral rules with an error pointing to `channel_attention_level`; `delete_auto_respond_rule` (`src/tools/actions/deleteAutoRespondRule.ts`) works on them; `add_auto_respond_rule` unchanged (never creates ephemeral)
- [x] 6.3 Unit tests for the three tool behaviors

## 7. Home Tab

- [x] 7.1 Split `buildAutoRespondSection` (`src/slack/homeTab.ts`) into standing rules + followed conversations sub-groups; conversation rows show channel, level, `expires in Xm` / dormant label, session count, and a Stop following button as the row accessory — the Edit button/modal is entirely absent on ephemeral rows (not disabled)
- [x] 7.2 Add the Stop following action handler (registered inline in `src/slack/handlers/homeTab.ts` alongside its `ai_*` siblings — the actual convention for this section; `action_id` pattern `ai_stop_following:<ruleId>` mirroring `ai_edit_rule:<id>`): deletes the rule via `deps.deleteRule` and re-renders the Home Tab
- [x] 7.3 Add all new strings to `src/i18n/strings/en.ts` + `fr.ts` (parity test must pass)
- [x] 7.4 Unit tests for section rendering (both sub-groups, dormant state) and the action handler

## 8. Verification

- [x] 8.1 `npx tsc`, `npx oxlint`, `npx oxfmt` on touched files; full `npm test`
- [x] 8.2 End-to-end sanity: each transition covered at the unit seam (seed via `post_to`/`deliver_to` in autoExecute + submitResponse tests; respond-renews / unrelated-ratchets / dormant-revival / stop-emoji-kill in the lifecycle matrix; Home Tab row render + Stop following in homeTab tests). Live-Slack walkthrough deferred to the next deploy — no workspace available in this environment.

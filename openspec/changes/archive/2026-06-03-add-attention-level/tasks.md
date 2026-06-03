## 1. Session model: the dial

- [x] 1.1 Add `AttentionLevel = "always" | "high" | "medium" | "low" | "off"` type and `attentionLevel?` field to `SessionContext` in `src/sessions.ts`
- [x] 1.2 Add `isEngaged(session)` helper (`(attentionLevel ?? "medium") !== "off"`) and `setAttentionLevel(sessionId, level)` setter; export both
- [x] 1.3 Implement read-time migration on session load: absent `attentionLevel` → `autoResponseActive === false ? "off" : "medium"`; drop `autoResponseActive` on next persist
- [x] 1.4 Set initial level at `createSession`: resolve from trigger source (cron/rule level, else `"medium"`); never `"off"`
- [x] 1.5 Remove `autoResponseActive` field, its default, and `setAutoResponseActive` from `src/sessions.ts`
- [x] 1.6 Add/adjust unit tests for the field, `isEngaged`, the setter, and the read-time migration mapping

## 2. Retire `autoResponseActive` across call sites

- [x] 2.1 Repo-wide grep for `autoResponseActive` and `setAutoResponseActive`; enumerate every reader/writer
- [x] 2.2 `src/slack/handlers/autoRespond.ts` — replace engaged check with `isEngaged`; thread-age sweep disengage now sets `"off"`
- [x] 2.3 `src/slack/handlers/mention.ts` — re-activation sets `"medium"` (only when currently `"off"`)
- [x] 2.4 `src/slack/stopPipeline.ts` and inline-stop path — set `"off"`
- [x] 2.5 `src/tools/query/stopTracking.ts` — set `"off"`
- [x] 2.6 Change-thread button handler(s) — re-activation sets `"medium"` when currently `"off"`
- [x] 2.7 `src/slack/handlers/handlerResponse.ts` — drive disengage from `attention_level: "off"` (see task 5)

## 3. Pre-analysis: level-keyed policy

- [x] 3.1 Add a `level` parameter to `runPreAnalysis` in `src/claude/preAnalysis.ts`; extract the lean + tie-breaker section into a POLICY block keyed by level, keeping shared scaffolding intact
- [x] 3.2 `low` policy = current prompt verbatim (`respond | skip | stop`); `medium`/`high` policies omit `stop` (verdict space `respond | skip`) and lean progressively more toward `respond`
- [x] 3.3 Ensure the parser only honors `"stop"` when level is `low`
- [x] 3.4 Leave `runActiveRunPreAnalysis` unchanged for `low|medium|high`
- [x] 3.5 Unit tests: each level's policy text/verdict space; `stop` only emitted/honored at `low`

## 4. Gates in the auto-respond handler

- [x] 4.1 Gate B (thread reply): `off` → ignore; `always` → skip pre-analysis and `processMessage()`; else `runPreAnalysis(level)`
- [x] 4.2 Gate A (top-level rule match, no session): use rule level as policy, capping `always → high`; start session only on `"respond"`
- [x] 4.3 Active-run path: `always` bypasses `runActiveRunPreAnalysis` (append all); other levels unchanged
- [x] 4.4 Persist `attentionLevel = "off"` when a `low` thread reply returns `"stop"`
- [x] 4.5 Tests for Gate A cap, Gate B short-circuit/ignore, and low-only auto-disengage

## 5. submit_response: attention_level replaces disengage

- [x] 5.1 Add `attention_level` to `SubmitResponseArgs` and the schema builder in `src/tools/presentation/submitResponse.ts`; full ladder incl. `"off"` in tracking-capable contexts, `off` excluded otherwise
- [x] 5.2 Remove the `disengage` boolean from the schema, args, and handler; route the former disengage path through `attention_level: "off"`
- [x] 5.3 Remove `disengage` from `MessagePayload` exclusion handling and add `attention_level` to the primary-only excluded fields (per `clack-tool-response` delta)
- [x] 5.4 On successful delivery, persist the supplied `attention_level` via `setAttentionLevel`; do not change level on failed delivery
- [x] 5.5 Surface the session's current level + tuning/disengage guidance in the delivery-context prompt and the `attention_level` parameter description
- [x] 5.6 Update `handlerResponse.ts` to apply the captured level (incl. `"off"` disengage) instead of the old `disengaged` flag
- [x] 5.7 Tests: raise/lower/off persistence, off-excluded contexts, failed-delivery no-op, MessagePayload rejects `attention_level`

## 6. Rule and plugin-cron sources

- [x] 6.1 Add `attentionLevel?: "always" | "high" | "medium" | "low"` to `AutoRespondRule` in `src/autoRespond.ts`; thread it through `addRule`/`updateRule` (empty string clears) with `"off"` rejected
- [x] 6.2 Add the `attentionLevel` arg to `add_auto_respond_rule` and `update_auto_respond_rule` tools; surface it in `list_auto_respond_rules`
- [x] 6.3 Add `attentionLevel?` to `CronJobSpec` in `src/cronJobs.ts`; forward it into session creation as the initial level
- [x] 6.4 Allow plugin spec builders (e.g. trivia `buildGameSpecs`) to set `attentionLevel`; pick a sensible default for trivia threads
- [x] 6.5 Tests: rule field plumbing (set/clear/reject-off), cron spec → initial session level

## 7. Verify

- [x] 7.1 `npx tsc` clean; `npx oxlint` and `npx oxfmt --check` on touched files
- [x] 7.2 `npm test` green; no residual `autoResponseActive` / `disengage` references remain
- [x] 7.3 `openspec validate add-attention-level --strict` passes
- [x] 7.4 Run `graphify update .` to refresh the graph after code changes

## 8. Read/write exposure across MCP + SDK surfaces

- [x] 8.1 `submit_response.attention_level` writes the level (Claude-driven), with the current level read in the delivery prompt
- [x] 8.2 Auto-respond rule tools: `add`/`update` write `attentionLevel`; `list_auto_respond_rules` reads it (full rule object)
- [x] 8.3 Scheduled-message tools: `create_scheduled_message`/`update_scheduled_message` write `attentionLevel`; `list_scheduled_messages`/`get_scheduled_message` read it
- [x] 8.4 Plugin SDK `startThreadConversation` carries `attentionLevel` through to the created session
- [x] 8.5 Trivia "Tell me more" starts its follow-up thread at `attentionLevel: "high"`

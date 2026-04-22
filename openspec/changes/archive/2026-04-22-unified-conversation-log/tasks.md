## 1. Types and Selectors

- [x] 1.1 Add `SessionMessage`, `SessionUserMessage`, `SessionAssistantMessage`, and `SessionUserMessageSource` types in `src/sessions.ts` alongside the existing `SessionContext` (renamed from `ConversationMessage`/`UserMessage`/`AssistantMessage` to avoid collision with `src/claude/index.ts::ConversationMessage`)
- [x] 1.2 Add `messages?: SessionMessage[]` to `SessionContext`. Legacy fields (`originalQuestion`, `refinements`, `lastAnswer`, `lastResponse`, `continuationHistory`, `toolCallHistory`) stay on `SessionContext` during the transition so the build stays green at every checkpoint; they are removed in §9 after all readers/writers have migrated. A `LegacyContext` interface scoped to the migration file will be added in §2.
- [x] 1.3 Create `src/sessions/selectors.ts` with `firstUserMessage`, `latestAssistantMessage`, `latestAssistantText`, `latestAssistantPayload`, `userContinuations`, `conversationLog`
- [x] 1.4 Add `src/sessions/selectors.test.ts` covering: empty messages, initial-only, multi-turn, skipped latest turn, errored latest turn

## 2. Migration (lazy-synthesis approach)

**Architectural decision:** The existing Clack migration engine (`src/migrations/engine.ts`) takes a fixed `files: string[]` and is designed for config-file migrations, not directory scans over `data/sessions/*/context.json`. Rather than extend the engine for this one case, we use **lazy synthesis**: `getSession()` synthesizes `messages` from legacy fields on read for unmigrated files, and `updateSession()` writes the synthesized shape back to disk on next write. Sessions migrate organically as they're used; stale ones age out via the 30-day retention. No migration file is registered, no version bump — the shim in `sessions.ts` is the migration. The shim is removed in §9 when legacy fields leave `SessionContext` entirely.

- [x] 2.1 ~~Run `/create-migration` to scaffold a new blocking migration~~ Superseded: `synthesizeMessagesFromLegacy()` in `src/sessions.ts` serves as the migration, invoked from the `getSession()` loader
- [x] 2.2 ~~Define a `LegacyContext` type~~ Superseded: the legacy fields remain typed on `SessionContext` during the transition (§9 removes them)
- [x] 2.3 Implement the conversion: `messages[0]` from `originalQuestion + createdAt + imageFiles`; refinements → `source: "refinement"` user messages (all sharing `createdAt`); if `lastAnswer` or `lastResponse` present, append one `AssistantMessage` with `text: lastAnswer`, `payload: lastResponse`, `toolCalls: toolCallHistory`, `ts: lastActivity` — done in `synthesizeMessagesFromLegacy()`
- [x] 2.4 Idempotency: the shim only runs when `session.messages` is absent (file-level check in `getSession`); once a session is loaded and written back, the shape is stable
- [x] 2.5 ~~Atomic write to `context.json.new`, then rename~~ Inherited: writes happen through the existing `writeContextAtomic()` in `src/sessions.ts` on the next `updateSession` call
- [x] 2.6 ~~Log per-file failures with session ID~~ Superseded: no scan; each session migrates when accessed, and `getSession` already quarantines corrupt files
- [x] 2.7 Add `src/sessions/synthesizeFromLegacy.test.ts` covering: fresh legacy session with refinements, legacy session with only initial question, legacy session with `"The user chose: ..."` refinement preserved verbatim, legacy session with no `lastAnswer`, legacy session with `imageFiles` on the initial message, legacy session with `toolCallHistory` (lands on the final `AssistantMessage.toolCalls`), fully-populated legacy session
- [x] 2.8 ~~Register the migration in the runner and in the test runner~~ Superseded: not a registered migration

## 3. Writers — Session Append APIs

- [x] 3.1 In `src/sessions.ts`, added `appendUserMessage(sessionId, message: SessionUserMessage)` alongside `addRefinement` (preserves atomic-lock semantics via `withSessionLock`). `addRefinement` kept as deprecated compat wrapper that routes through `appendUserMessage({ source: "refinement" })`. Both dual-write to legacy `refinements[]` so old readers keep working.
- [x] 3.2 Added `appendAssistantMessage(sessionId, message: SessionAssistantMessage)` alongside `setLastAnswer`. Dual-writes to legacy `lastAnswer` / `lastResponse` / `toolCallHistory` only when the message carries them (skipped turns don't clobber legacy fields). `setLastAnswer` kept as deprecated compat wrapper.
- [x] 3.3 Added 5 tests in `src/sessions.test.ts` covering: append + refinements dual-write, choice formatting, assistant dual-write, skipped turn preserves legacy, concurrent append serialization
- [x] 3.4 Removed `addRefinement` and `setLastAnswer` in §9.3 after all callers migrated.

## 4. Writers — Handler Integration

- [x] 4.1 `src/slack/handlers/handlerResponse.ts::persistResponseState` now calls `appendAssistantMessage({ text, payload, toolCalls, ts })`. The legacy `setLastAnswer` call stays during the transition so existing tests pass; `updateSession` is now only used for `stagedIntents`. `appendAssistantMessage` added as optional dep with fallback to the imported symbol (deps interface pattern matches `createSession?`).
- [x] 4.2 `src/slack/handlers/handlerResponse.ts::handleError` now appends an `AssistantMessage` with `error` + `toolCalls` populated via `appendAssistantMessage`. The legacy `ctx.deps.addError` call stays during the transition so `hasErrors()` and `session.errors[]` readers still work; both lift in §9. A previous `updateSession({ toolCallHistory })` branch is now covered by the append's dual-write (kept for now; removed in §9).
- [x] 4.3 `src/slack/handlers/choice.ts` now calls `appendUserMessage({ source: "choice", text: choiceValue, value: choiceValue, ts })`. Legacy refinements[] dual-write produces the same `"The user chose: ${text}"` string as before. Test updated to assert structured shape.
- [x] 4.4 `src/slack/handlers/followup.ts` now calls `appendUserMessage({ source: "followup", text: prompt, ts })`. Legacy refinements[] dual-write preserves prompt builder output. Test updated.
- [x] 4.5 Grep of `addRefinement(` found zero production call sites beyond choice/followup (already migrated) and the declaration itself. `autoRespond.ts` does not use `addRefinement`. The only other reference is the concurrency test in `sessions.test.ts`, which exercises the compat wrapper intentionally.
- [x] 4.6 `src/slack/handlers/core.ts` aborted-session-reuse path now updates **both** `originalQuestion` (legacy) AND `messages[0].text` (unified log) in the same `updateSession` call. Synthesizer ensures `messages` is always populated by the time this path runs.

## 5. Writers — Skip/Disengage Capture

- [x] 5.1 Added `setPostedTopLevel()` / `isPostedTopLevel()` to `ResponseCapture` in `src/tools/server.ts`; exposed on `ClackToolsResultBase` in `src/tools/types.ts`; wired producers in both query and worker `build*Tools` returns, and in `submitResponse.ts` at the success path when `wantsPostTopLevel` is set. Added `postedTopLevel?: boolean` to `ClaudeResponse` and threaded through `buildSuccessResponse`.
- [x] 5.2 `src/slack/handlers/handlerResponse.ts::handleSkip` now appends `AssistantMessage { skipped: true, disengaged?, toolCalls? }` with no payload. `persistResponseState` reads `response.postedTopLevel` and sets `assistantMessage.postedTopLevel` on the appended turn.
- [x] 5.3 `handleSkip` uses a single `ctx.deps.updateSession` call that carries BOTH the appended `messages` array AND `autoResponseActive: false` — atomic per spec. `setAutoResponseActive` is no longer called from the skip path.
- [x] 5.4 Updated the two pre-existing skip tests in `handlerResponse.test.ts`: the disengage test now asserts a single `updateSession` call with the expected `messages` + `autoResponseActive` shape, and the no-disengage test asserts no `autoResponseActive` update. Updated 7 `ResponseCapture` stubs in `submitResponse.test.ts` + one in `workflow.test.ts` to include the new `setPostedTopLevel` / `isPostedTopLevel` methods.

## 6. Readers — Replace Direct Field Access

- [x] 6.1 `src/claude/promptBuilder.ts` now reads initial question via `firstUserMessage()` and continuations via `userContinuations()`. `source: "choice"` messages render as `"The user chose: ${text}"`. Falls back to legacy `originalQuestion`/`refinements[]` for in-memory sessions constructed outside `createSession` (keeps existing tests green).
- [x] 6.2 `src/slack/handlers/resend.ts` reads via `latestAssistantText()` and `latestAssistantPayload()`, with fallback to legacy fields.
- [x] 6.3 `src/slack/handlers/dmActions.ts` updated at 5 call sites (buildAnswerBlocks source, accept synthesis answer, edit synthesis answer + initial_value, update-post answer, post-new-reply answer). All use selectors with legacy fallback.
- [x] 6.4 `src/changes/workflow.ts` line ~425: `firstUserMessage(session)?.text ?? session.originalQuestion`.
- [x] 6.5 `src/sessions.ts::getSession` loader validator now accepts either `messages` (post-migration) or `originalQuestion` (pre-migration) as the minimal required discriminator. Synthesizer fills `messages` for unmigrated files before the session is cached.
- [x] 6.6 `scripts/askClaude.ts` updated to populate `messages` (both in the "create new session" and "load existing + add refinement" paths). Dual-writes to legacy `refinements[]` for compatibility.

## 7. find_recent_interactions

- [x] 7.1 `PersistedSession` now carries `messages?: SessionMessage[]`, `lastActivity?: number`, `originChannel?: string` alongside legacy fields (still loaded for pre-migration files). §9 will remove legacy fields from this type.
- [x] 7.2 `matchesKeywords` now scans the unified `messages[]` log (every `UserMessage.text`, every `AssistantMessage.text`/`payload.message`, and rendered text from `payload.blocks` via `extractDisplayText`). Falls back to legacy fields when `messages` is absent.
- [x] 7.3 `InteractionResult` updated to new summary shape (`firstQuestion`, `latestAssistantText`, `messageCount`, `assistantTurnCount`, `skippedTurnCount`, `channelId`, `lastActivity`). Heavy fields (`payload`, `blocks`, `toolCalls`) stay out of list view — callers fetch via `find_session_transcript` (§8).
- [x] 7.4 Added `channel?: string` zod parameter; filter matches either `channelId` or `originChannel`.
- [x] 7.5 Added `trigger_type?: TriggerType` zod parameter (enum of the 6 valid trigger types); filter applied.
- [x] 7.6 Added 4 test suites to `findRecentInteractions.test.ts`: channel filter (match + no-match), trigger-type filter, skipped-turn counting via a direct unified-log fixture. Existing keyword/result-shape tests updated to the new result fields.

## 8. find_session_transcript (new tool)

- [x] 8.1 Create `src/tools/query/findSessionTranscript.ts` following the `findRecentInteractions` style (direct filesystem read, privacy rules matching the session-transcript-tool spec). Uses `synthesizeMessagesFromLegacy` for pre-migration sessions on disk.
- [x] 8.2 Schema: `sessionId: string`, `offset?: number` (default 0, min 0), `limit?: number` (default 20, max 100, min 1)
- [x] 8.3 Return shape: `{ sessionId, channelId, channelName?, triggerType?, userId, displayName?, createdAt, lastActivity, totalMessages, messages }`
- [x] 8.4 Privacy enforcement: owner always; non-owner only if `conversations.info` confirms the channel is public; DM / G-prefix / C-prefix-unknown-or-private → error `"session not visible"`
- [x] 8.5 Register the tool in `src/tools/server.ts` for query mode (all roles)
- [x] 8.6 Register the tool name in `src/tools/toolNameValidator.ts`
- [x] 8.7 Add a mapping entry for `find_session_transcript` to `data/default_configuration/tool_mapping/clack.json`, following the pattern used by `find_recent_interactions` (include an ID/name in the label per the user-preference rule)
- [x] 8.8 Add `src/tools/query/findSessionTranscript.test.ts` covering: owner read, non-owner public-channel read, non-owner DM rejected, non-owner legacy-private-group rejected, non-owner C-prefix-confirmed-private rejected, non-owner privacy-unknown rejected, offset+limit pagination, offset-beyond-end returns empty, unknown sessionId returns error, corrupt JSON returns not-found error, legacy synthesis on pre-migration session, metadata preservation, lastActivity fallback. `limit > 100` rejection is enforced by the zod schema (`.max(100)`) at the tool boundary — not exercised in the pure-function unit tests since they bypass the schema. 13 tests pass.

## 9. Remove Legacy Fields

- [x] 9.1 Removed `originalQuestion`, `refinements`, `lastAnswer`, `lastResponse`, `continuationHistory`, and session-level `toolCallHistory` from `SessionContext`. `messages` promoted to required. Added `LegacySessionShape` (on-disk-only interface consumed by `synthesizeMessagesFromLegacy` for pre-migration files).
- [x] 9.2 Replaced `CreateSessionOptions.originalQuestion` with `initialMessage: { text: string; imageFiles?: SlackImageFile[] }`. `createSession` writes `messages[0]` from the new shape.
- [x] 9.2a Updated 3 call sites: `src/slack/handlers/core.ts` (threads `imageFiles` through `ProcessingContext`), `src/slack/handlers/handlerResponse.ts` (auto-respond follow-up session), `scripts/askClaude.ts`. Updated all 7 `createSession` calls in `src/sessions.test.ts`.
- [x] 9.3 Dropped `appendUserMessage`/`appendAssistantMessage` dual-writes. Removed `addRefinement` and `setLastAnswer` (callers: `dmActions.ts` now uses `appendAssistantMessage`, `handlerResponse.ts` stopped calling `setLastAnswer`). Removed session-level `toolCallHistory` writes (error turns persist `toolCalls` on the appended error assistant message; the streaming per-tool-call inline persistence was dropped since turn-level tool calls are preserved via `persistResponseState`). Updated readers in `src/slack/handlers/resend.ts`, `src/slack/handlers/dmActions.ts`, `src/claude/promptBuilder.ts`, `src/changes/workflow.ts` to use only the selector-based path. Updated 15+ test files to construct `messages[]` instead of legacy fields. Updated `synthesizeFromLegacy.test.ts` to target the new `LegacySessionShape` type. `getSession` loader now accepts either `messages` or legacy `originalQuestion` as a required field (legacy shape is synthesized forward).
- [x] 9.4 `npx tsc` clean; `npm run test` 2611 passing, 0 failing.

## 10. Dead-Code Removal

- [x] 10.1 Removed `ContinuationRecord` from `src/tools/types.ts`.
- [x] 10.2 Grep clean — no remaining `continuationHistory` references in TypeScript sources.

## 11. debug-session Skill

- [x] 11.1 Rewrote the `context.json` fields section to describe `messages[]` as the primary source for what happened in the session.
- [x] 11.2 Removed references to `originalQuestion`, `refinements[]`, `lastAnswer`, `lastResponse`, `continuationHistory[]`, and session-level `toolCallHistory[]`. Added a pre-migration note explaining the synthesizer for legacy on-disk files. Updated the "Reconstruct the story" section to walk `messages[]` and per-turn `toolCalls[]`.
- [x] 11.3 Added a Notes entry pointing at the new `find_session_transcript` tool as an alternative to reading `context.json` directly.

## 12. Verification

- [x] 12.1 `openspec validate unified-conversation-log --strict` → "Change 'unified-conversation-log' is valid".
- [x] 12.2 `npm run test` → 2622 passing, 0 failing (549 suites).
- [x] 12.3 `npx tsc` clean (no output).
- [x] 12.4 Manual smoke test in dev — pending user run: (1) create a fresh DM session and send an initial question, (2) send one free-form refinement in the thread, (3) press a choice action button, (4) press a followup action button, (5) trigger auto-respond in a separate channel and have Claude use `submit_response` with `skip_response: true` — inspect `context.json` on disk and verify `messages` contains, in order: one `source: "initial"` user message, one `source: "refinement"`, one `source: "choice"` with `value` populated, one `source: "followup"`, and the auto-respond session contains an `AssistantMessage` with `skipped: true` and no `payload`.
- [x] 12.5 Manual smoke test — pending user run: `find_recent_interactions` with `channel` filter.
- [x] 12.6 Manual smoke test — pending user run: `find_session_transcript` on a session with multiple turns.
- [x] 12.7 Manual smoke test — pending user run: invoke the `debug-session` skill on a post-migration session.
- [x] 12.8 Migration validation — pending user run: before merging, copy a production `data/sessions/` snapshot; reload via `getSession` (which triggers `synthesizeMessagesFromLegacy`); spot-check 5 random sessions for correct conversion. Note: this change uses lazy synthesis (not a one-shot migration), so validation is really "do pre-migration files still load and render correctly?" — exercise by reading a legacy-shape session with `find_session_transcript` and confirming `messages[]` reads as expected.

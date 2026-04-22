## 1. Types

- [x] 1.1 Add `SessionTrigger` discriminated union in `src/sessions.ts` (five variants: `reactions`, `mentions`, `directMessages`, `autoRespond`, `scheduled`)
- [x] 1.2 Add required `trigger: SessionTrigger` to `SessionContext`; remove top-level `imageFiles`
- [x] 1.3 Change `SessionUserMessageSource` from `"initial" | "refinement" | "choice" | "followup"` to `"reply" | "choice" | "followup"`
- [x] 1.4 Add optional `preAnalysis?: string` to `SessionAssistantMessage`
- [x] 1.5 Replace `CreateSessionOptions.initialMessage` with `CreateSessionOptions.trigger: SessionTrigger`; `createSession` now starts with `messages: []`

## 2. Synthesizer

- [x] 2.1 Rewrite `synthesizeMessagesFromLegacy` to produce `{ trigger, messages[] }` from the legacy on-disk shape (`originalQuestion + triggerType + imageFiles + refinements + lastAnswer + lastResponse + toolCallHistory`)
- [x] 2.2 Extend the synthesizer to also handle first-wave `unified-conversation-log` shape (files where `messages[0]` is a `SessionUserMessage { source: "initial" }`). Lift the initial entry off `messages[]` into a synthesized `trigger`; convert subsequent `source: "initial"|"refinement"` → `"reply"`
- [x] 2.3 `getSession` loader: invoke synthesizer when `trigger` field is absent; after synthesis the in-memory session is always in final shape (next `updateSession` writes it back)
- [x] 2.4 Update `src/sessions/synthesizeFromLegacy.test.ts` to assert the new `(trigger, messages[])` output for: legacy-shape fresh session, legacy-shape with refinements, legacy-shape with `"The user chose: ..."` refinements preserved verbatim, first-wave unified-log shape → final shape, scheduled trigger type inference

## 3. Selectors + Prompt Builder

- [x] 3.1 Update `firstUserMessage(session)` in `src/sessions/selectors.ts` to synthesize a virtual `SessionUserMessage` from `trigger.messageText` or `trigger.prompt` (for scheduled)
- [x] 3.2 Add new selector `triggerText(session)` returning the raw trigger text (`messageText` ?? `prompt`)
- [x] 3.3 `userContinuations(session)` — no signature change, just remove `"initial"` from the filter rule (only `messages[]` user entries are continuations now; there's no "initial" user entry anymore)
- [x] 3.4 Update `src/claude/promptBuilder.ts` to read `triggerText()` for the `QUESTION:` line and `userContinuations()` for the `ADDITIONAL INSTRUCTIONS FROM USER:` block
- [x] 3.5 Update `src/sessions/selectors.test.ts` for the new selector behavior — empty `messages[]` should still yield a valid `firstUserMessage` derived from the trigger

## 4. setupSession in core.ts

- [x] 4.1 On new-session branch, build `SessionTrigger` from `params.triggerType` + `messageTs` + `messageText` + `imageFiles` + optional `preAnalysis`; pass to `createSession`
- [x] 4.2 On reuse branch, remove `isAbortEdit` branching. Always append `SessionUserMessage { source: "reply", text: processedMessageText, ts: Date.now() }` via `appendUserMessage` (or an inline update equivalent)
- [x] 4.3 Add `preAnalysis?: string` to `ProcessMessageParams` so the autoRespond handler can thread its verdict through
- [x] 4.4 `setupSession` passes `preAnalysis` into the trigger on creation (only for autoRespond type, since it's the only type that runs pre-analysis)

## 5. Handlers — Pre-Analysis Flow

- [x] 5.1 `src/slack/handlers/autoRespond.ts` — pass the pre-analysis verdict through to `processMessage({ preAnalysis: verdict })` when it calls processMessage (both for session creation and threadReply continuations)
- [x] 5.2 `src/slack/handlers/handlerResponse.ts::persistResponseState` — read `preAnalysis` from the delivery context (or `processMessage` params), stamp it onto the appended `SessionAssistantMessage` when present
- [x] 5.3 `src/slack/handlers/handlerResponse.ts::handleSkip` — same preAnalysis stamping for skipped turns
- [x] 5.4 Add a `DeliveryContext.preAnalysis?: string` (or equivalent) carrier between `processMessage` → `executeAndDeliver` → `persistResponseState`/`handleSkip`

## 6. Scheduled cron

- [x] 6.1 `src/cronScheduler.ts` — when calling `processMessage`, allow the trigger to be built as `{ type: "scheduled", jobId, prompt, preAnalysis? }` inside `setupSession`. Either pass `jobId` through `ProcessMessageParams` or rely on `triggerType === "scheduled"` + a dedicated hook
- [x] 6.2 Capture cron skip-condition verdict (if any) as `trigger.preAnalysis` on the scheduled session

## 7. Test fixture migration

- [x] 7.1 Update all `SessionContext` literal fixtures (>20 test files) to include `trigger: { type: ..., ... }` instead of `messages: [{ role: "user", source: "initial", ... }]`
- [x] 7.2 Update any fixture that uses `source: "initial"` or `source: "refinement"` to use `"reply"`
- [x] 7.3 Update fixtures that used `SessionContext.imageFiles` top-level to put `imageFiles` on the trigger instead
- [x] 7.4 Update `src/sessions.test.ts` tests for `createSession`/`appendUserMessage`/`appendAssistantMessage` to reflect the new shape
- [x] 7.5 Update `src/slack/handlers/core.test.ts::"reuses existing session when thread found"` to assert the appended `source: "reply"` entry
- [x] 7.6 Add new test case: `setupSession` on reuse does NOT mutate `trigger` or `messages[0]`
- [x] 7.7 Add new test case: scheduled cron creates `trigger: { type: "scheduled", prompt, jobId? }` and `messages: []` on session creation; first `submit_response` delivery puts the assistant at `messages[0]`

## 8. Query tools

- [x] 8.1 `src/tools/query/findRecentInteractions.ts` — replace `firstQuestion` derivation with `triggerText()` selector (or equivalent inline read of trigger); update the `PersistedSession` interface to carry `trigger` (optional during legacy-read transition)
- [x] 8.2 `src/tools/query/findSessionTranscript.ts` — include `trigger` in the return shape; adjust `PersistedSession` type accordingly; `resolveMessages` helper now also produces a trigger when legacy/first-wave shape is detected
- [x] 8.3 Update `src/tools/query/findRecentInteractions.test.ts` keyword-scan fixtures and the `InteractionResult` assertions to reflect trigger-derived `firstQuestion`
- [x] 8.4 Update `src/tools/query/findSessionTranscript.test.ts` with: scheduled-trigger session transcript, user-first-trigger session transcript, trigger included in return shape, legacy-shape synthesis produces correct trigger

## 9. Skill + OpenSpec docs

- [x] 9.1 Update `.claude/skills/debug-session/SKILL.md` to describe `trigger` + `messages[]` as distinct session artifacts; remove mentions of `source: "initial"`
- [x] 9.2 Note in the skill that `find_session_transcript` returns trigger alongside messages — useful as a one-shot fetch
- [x] 9.3 Verify `openspec validate separate-session-trigger --strict` passes

## 10. Verification

- [x] 10.1 `npx tsc --noEmit` clean
- [x] 10.2 `npm run test` all pass (including new tests in §§7–8)
- [x] 10.3 Docker rebuild + manual smoke: scheduled cron → inspect `context.json` → `trigger: { type: "scheduled", prompt, ... }`, `messages[0]` is an assistant turn (NOT a user initial)
- [x] 10.4 Manual smoke: user replies in scheduled thread → new user `source: "reply"` entry appended, trigger untouched, `messages[0]` untouched
- [x] 10.5 Manual smoke: autoRespond-triggered session → `trigger.preAnalysis` populated, first assistant `messages[0]` also carries `preAnalysis`
- [x] 10.6 Manual smoke: autoRespond thread-reply continuation → new assistant entry carries its own `preAnalysis` for that turn
- [x] 10.7 Manual smoke: load a pre-migration on-disk session → synthesizer produces `(trigger, messages[])`; `find_session_transcript` returns both correctly

## 11. Dead-code cleanup

- [x] 11.1 Remove any remaining references to `"initial"` or `"refinement"` source values outside migration code
- [x] 11.2 Remove `isAbortEdit` and related comments from `core.ts` once §4 lands
- [x] 11.3 Remove `imageFiles` from `SessionContext` top level (kept during transition only if needed for legacy reads — prefer putting it exclusively on the trigger)

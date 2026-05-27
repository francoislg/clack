## 1. Config schema

- [x] 1.1 Add `dmType?: "assistant" | "classic"` to `DirectMessagesConfig` in `src/config.ts` (default `"assistant"` at parse time)
- [x] 1.2 Extend the `directMessages` parser to validate the new field and reject any other string value with a clear error
- [x] 1.3 Update `data/config.example.json` with a commented-out `dmType` entry showing both valid values

## 2. Classic DM handler

- [x] 2.1 Create `src/slack/handlers/classicDm.ts` exporting `registerClassicDmHandlers(app, deps?)` — single `app.event("message")` listener
- [x] 2.2 Implement filtering: skip if `channel_type !== "im"`, `bot_id` present, any `subtype`, or empty (no text AND no files)
- [x] 2.3 Bridge `matchesInlineStopEmoji` → `stopThread` before any `processMessage` call (parity with assistant handler)
- [x] 2.4 Call `extractAttachments` on `event.files` and forward to `processMessage`
- [x] 2.5 Use the same image-only fallback prompt string as assistant mode (extract a shared constant if not already shared)
- [x] 2.6 Pass `triggerType: "directMessages"`, `threadTs: event.thread_ts`, `assistantChannelId: undefined`
- [x] 2.7 Mirror the assistant handler's dependency-injection pattern (`ClassicDmDeps` interface + `defaultClassicDmDeps`) for test seams

## 3. Manifest generator

- [x] 3.1 In `scripts/generate-manifest.ts`, read `config.directMessages.dmType` (default `"assistant"`)
- [x] 3.2 Move `assistant:write` out of the unconditional DM scope list into an assistant-only branch
- [x] 3.3 Move `assistant_thread_started`, `assistant_thread_context_changed` out of the unconditional DM event list into an assistant-only branch
- [x] 3.4 Gate the `assistant_view` feature emission on `dmType === "assistant"`
- [x] 3.5 Update the manifest-script console output to print the resolved `dmType` alongside the other enabled features

## 4. App wiring

- [x] 4.1 In `src/slack/app.ts`, replace the unconditional `registerAssistant(app)` call with a branch on `directMessages.dmType`
- [x] 4.2 Import `registerClassicDmHandlers` and call it when `dmType === "classic"`
- [x] 4.3 Add a startup log line stating which DM mode was registered

## 5. Audit `assistantChannelId` consumers

- [x] 5.1 Grep for `assistantChannelId` and confirm every read site treats it as optional (no non-null assertion, no `!`) — verified: all read sites use truthy guards (`if (params.assistantChannelId)`), optional chaining (`session.assistantCurrentChannelId?`), or fallback chains (`a || session.assistantCurrentChannelId || b`). No code changes needed.
- [x] 5.2 Document findings in the change's design doc or as a code comment if any consumer needs adjustment — no adjustment needed; audit recorded in 5.1.

## 6. Tests

- [x] 6.1 Add `src/slack/handlers/classicDm.test.ts` covering: non-IM channel ignored, bot message ignored, subtyped message ignored, empty message ignored, top-level DM → `processMessage(threadTs=undefined)`, thread reply → `processMessage(threadTs=…)`, image-only DM → fallback prompt, inline stop emoji → `stopThread` short-circuit
- [x] 6.2 Add a test to the existing manifest-generator test file (or create one) covering: `dmType="classic"` omits `assistant:write`, `assistant_thread_*` events, and `assistant_view`; `dmType="assistant"` includes them; `dmType` absent → assistant
- [x] 6.3 Add an `app.ts` registration test that verifies `registerAssistant` is NOT called when `dmType="classic"`, and `registerClassicDmHandlers` is NOT called when `dmType="assistant"` (use the existing DI pattern)
- [x] 6.4 Run `npm test` and `npx tsc` — both clean (260 test files, 4483 passing)

## 7. Documentation

- [x] 7.1 Update `CLAUDE.md` "Three Trigger Modes" section: mention the `dmType` sub-mode under Direct Messages and the restart + manifest re-upload caveat
- [x] 7.2 Update the README setup section (if it touches the manifest) with a note about the new flag
- [x] 7.3 Add a one-line warning in the manifest script output reminding operators that flipping `dmType` requires re-uploading the manifest

## 8. Verification

- [ ] 8.1 Manual smoke test: set `dmType="classic"`, regenerate manifest, re-upload, restart, DM the bot — verify response arrives in a thread and follow-ups continue the session (operator-driven; cannot run from local environment)
- [ ] 8.2 Manual smoke test: image-only DM in classic mode → bot responds using the fallback prompt (operator-driven)
- [ ] 8.3 Manual smoke test: inline stop emoji in classic-mode DM → in-flight work is cancelled (operator-driven)
- [ ] 8.4 Flip back to `dmType="assistant"`, regenerate + re-upload manifest, restart, confirm assistant-mode behavior unchanged (operator-driven)
- [x] 8.5 `openspec validate add-classic-dm-mode --strict` passes

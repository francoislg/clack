## 1. Auto-respond listener gate

- [x] 1.1 In `src/slack/handlers/autoRespond.ts`, add a module-level `ADMITTED_SUBTYPES` set containing `"bot_message"`, `"file_share"`, `"thread_broadcast"`, and `"me_message"`
- [x] 1.2 Rewrite the subtype gate in `handleAutoRespondMessageEvent` (currently `autoRespond.ts:693-696`) to return only when `subtype` is defined AND not in `ADMITTED_SUBTYPES`; update the comment so it names `file_share` as an admitted user message rather than listing only rejects
- [x] 1.3 In the standing-rule path (`autoRespond.ts:459-461`), replace the bail-out on empty text with the same image-only synthesis its thread (`286-295`) and ephemeral (`563-571`) siblings use: call `extractAttachments(rawFiles)` and fall back to `buildImageOnlyPreAnalysisText(imageFiles)`, returning `null` only when there is neither text nor an image

## 2. Classic DM listener gate

- [x] 2.1 In `src/slack/handlers/classicDm.ts`, add a module-level `ADMITTED_SUBTYPES` set (`"file_share"`, `"thread_broadcast"`, `"me_message"` — no `"bot_message"`) plus an `isAdmittedSubtype(subtype: unknown): boolean` guard that narrows with `typeof === "string"` before the membership test, since `RawMessageEvent.subtype` is `unknown`
- [x] 2.2 Change the `toClassicDmMessage` subtype filter (currently `classicDm.ts:85`) to reject a defined subtype only when `!isAdmittedSubtype(...)`, leaving the existing text-or-files emptiness check below it untouched

## 3. Tests

- [x] 3.0 Add the scaffolding the standing-rule path needs — it has no coverage today. The existing `call()` helper in `autoRespond.test.ts` hardcodes a `threadTs`, which forces the thread-reply path, and `loadRules` / `findMatchingRule` are module imports (`autoRespond.ts:5`) rather than injected deps. Put this in a NEW `src/slack/handlers/autoRespond.subtypes.test.ts` rather than the existing file — a `vi.mock` of `../../autoRespond.js` is module-wide, so co-locating it would impose the rules mock on every existing case; this also follows the precedent of `autoRespond.ephemeral.test.ts` being its own file per path. Needs (a) a `callTopLevel` helper passing `threadTs: undefined`, (b) a partial `vi.mock(import("../../autoRespond.js"), importOriginal)` — a full replacement breaks `getRules`, which `homeTab.ts` imports transitively — and (c) `vi.useFakeTimers()` pinned to the message ts, or the thread path's 60-minute `threadAutoRespondMaxAgeMinutes` cutoff disengages the session against the real clock
- [x] 3.1 Using that scaffolding, add a case: top-level `message` event with `subtype: "file_share"`, non-empty text, and `files` → the mocked rule matches and `deps.preAnalysis` is invoked with the message text
- [x] 3.2 Add a case: top-level `subtype: "file_share"` with no text and image `files` → the standing-rule path synthesizes placeholder text and `deps.preAnalysis` is invoked with it (this case fails against the un-fixed task 1.3 code, not just the un-fixed gate)
- [x] 3.3 Add a case: `subtype: "file_share"` with a `thread_ts` matching an engaged session → resolves the thread auto-respond path
- [x] 3.4 Add a case: `subtype: "message_changed"` → still returns without calling `processMessage`; and a case each for `subtype: "thread_broadcast"` and `subtype: "me_message"` → admitted past the gate
- [x] 3.5 Add a case driving `handleAutoRespondMessageEvent` end to end over the thread-reply path (the cheapest of the three to set up): a `file_share` event whose `files` survive `extractAttachments` and reach `processMessage` as attachments. One path suffices — the spec scenario does not bind a specific one
- [x] 3.6 In `src/slack/handlers/classicDm.test.ts`, add a case: DM with `subtype: "file_share"` and `files` → admitted and routed to `processMessage` with attachments; plus a case each for `subtype: "thread_broadcast"` and `subtype: "me_message"` with text → admitted
- [x] 3.7 Update the existing "uses the image-only fallback prompt when text is empty but files are present" case (`classicDm.test.ts:173`) to carry `subtype: "file_share"` — it currently asserts an event shape Slack never sends, since a message with `files` always arrives subtyped
- [x] 3.8 Leave the existing `classicDm.test.ts` cases for non-IM channels (`:54`), `bot_id` (`:69`), `message_changed` (`:85`), and empty text-and-files (`:101`) unchanged — they already cover the MODIFIED requirement's preserved scenarios and must still pass

## 4. Verification

- [x] 4.1 Run `npm test` — full suite green, including the existing `agent.test.ts` "routes message events through the shared DM message handler" case that covers agent-mode delegation to `handleClassicDmEvent`
- [x] 4.2 Run `npx oxlint src/slack/handlers/autoRespond.ts src/slack/handlers/classicDm.ts` and `npx oxfmt` on any file the formatter flags
- [x] 4.3 Run `npx tsc --noEmit` — no type errors, in particular on the `rawText` / `messageUser` / `messageBotId` / `rawFiles` reads now narrowing against `FileShareMessageEvent`. (Use `--noEmit` explicitly: this repo's `tsconfig` emits to `dist/` for `npm run build`, so a bare `npx tsc` would write compiled output into the tree)
- [x] 4.4 Grep `buildImageOnlyPreAnalysisText` call sites to confirm the auto-respond path now reaches them (no longer dead code)

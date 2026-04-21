## 1. Shared helper

- [x] 1.1 Add a `buildImageOnlyPreAnalysisText` helper (in `src/slack/imageFormatting.ts`) that takes an array of extracted image files and returns an `[attached images: name (file_id: id), ...]` string matching the prompt builder's thread-context format
- [x] 1.2 Add unit tests covering: single image, multiple images, empty/undefined cases, and format parity with `src/claude/promptBuilder.ts`

## 2. DM handler

- [x] 2.1 In `src/slack/handlers/assistant.ts:147`, change the empty-text guard to accept messages with `attachments.imageFiles?.length > 0`
- [x] 2.2 When text is empty but images are present, pass `"Answer based on the attached image(s)."` as `messageText` to `processMessage`
- [x] 2.3 Update `src/slack/handlers/assistant.test.ts` to cover image-only DM and no-text-no-files cases

## 3. @mention handler

- [x] 3.1 In `src/slack/handlers/mention.ts:42-50`, extend the empty-text guard to also accept when extracted images are present (`!messageText && !event.thread_ts && !attachments.imageFiles?.length`)
- [x] 3.2 When text is empty, images are present, and not in a thread, pass `"Answer based on the attached image(s)."` as `messageText`
- [x] 3.3 Verify the in-thread fallback path already forwards images alongside the existing `"Read the conversation above..."` prompt (should already work — add a test to guard it)
- [x] 3.4 Update `src/slack/handlers/mention.test.ts` with top-level image-only, in-thread image-only, and no-text-no-files scenarios

## 4. Reaction handler

- [x] 4.1 In `src/slack/handlers/newQuery.ts:163`, extend the `!resolved?.text` guard to also accept when `resolved.imageFiles?.length > 0`
- [x] 4.2 When text is empty and images are present, pass the reaction-specific fallback prompt (`"A user reacted to this message. Look at the attached image(s) and the surrounding conversation to determine what they're asking, then respond."`) as `messageText`
- [x] 4.3 Preserve work-mode semantics (no regression on `:clack-work:` reactions)
- [x] 4.4 Update `src/slack/handlers/newQuery.test.ts` with image-only reaction and no-text-no-files scenarios

## 5. Thread auto-respond pre-analysis

- [x] 5.1 In `src/slack/handlers/autoRespond.ts:234-239`, when `rawText?.trim()` is empty, check `event.files` for supported images via `extractAttachments`
- [x] 5.2 When images are present, build `textForAnalysis` using the shared helper from task 1.1 and continue into the existing pre-analysis path
- [x] 5.3 When text is empty and no images are present, preserve existing skip behavior and log
- [x] 5.4 When pre-analysis returns `respond`, ensure `respond()` receives the synthesized fallback (`"Answer based on the attached image(s)."`) as `messageText` — not the metadata placeholder
- [x] 5.5 Update `src/slack/handlers/autoRespond.test.ts` with image-only thread reply reaching pre-analysis, pre-analysis `stop` on image-only, and no-text-no-files skip

## 6. Cross-cutting verification

- [ ] 6.1 Manually test each trigger against a Slack workspace: DM with image, top-level @mention with image, reaction on image-only post, thread reply with image
- [ ] 6.2 Verify via logs that `view_slack_image` is called when Claude needs to see the image
- [x] 6.3 Run `npm run test` and `npx tsc` and fix any regressions
- [x] 6.4 Run `openspec validate accept-image-only-messages --strict` before archiving

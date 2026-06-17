## 1. Surface thread timestamp in delivery context

- [x] 1.1 In `src/claude/promptBuilder.ts`, add a thread-coordinate line emitting `session.threadTs`, gated on its presence, to the thread/reaction branch (~`:373`)
- [x] 1.2 Add the same line to the mention branch (~`:387-390`)
- [x] 1.3 Add the same line to the thread-reply branch (~`:363`)
- [x] 1.4 Phrase the line imperatively: tools that post directly to Slack should pass this `thread_ts` to land in the current thread (not the channel root)
- [x] 1.5 Confirm DM, auto-respond-without-thread, and channelless scheduled branches emit no thread-timestamp line

## 2. Update gemini-image usage instruction

- [x] 2.1 In `src/plugins/gemini-image/usageInstruction.ts` (~`:24`), add: when the delivery context provides a thread timestamp, pass it as `thread_ts` so the image posts in the thread
- [x] 2.2 Add guidance that a single generation request should produce exactly ONE posted image: iterate/inspect with `deliver: "data"` and only `upload` the final pick; do not post multiple variations unless the user explicitly asks

## 3. Verify

- [x] 3.1 Add/extend the promptBuilder unit test asserting the thread-timestamp line appears for reactions/mentions/thread-reply when `threadTs` is set, and is absent otherwise
- [x] 3.2 Run `npx tsc --noEmit`, `npx oxlint` on changed files, and `npm test` (pre-existing unrelated failure in `assistant.test.ts` from separate WIP; my changes are green)
- [x] 3.3 Manually confirm against the original failing session shape that the surfaced context now contains the thread_ts value

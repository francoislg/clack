## 1. Shared posting helper

- [x] 1.1 Create `src/slack/messagePoster.ts` exporting `postStructuredMessage(client, { channel, blocks, threadTs? })` that calls `chat.postMessage` then `chat.getPermalink` and returns `{ ts, permalink }`. Re-use the `notificationText` truncation logic from `handlerResponse.ts` for the `text` fallback parameter.
- [x] 1.2 Add `src/slack/messagePoster.test.ts` covering: successful post returns `{ ts, permalink }`; `chat.postMessage` failure propagates; `chat.getPermalink` failure surfaces a clear error; the `text` fallback is the truncated display text (≤ 500 chars).
- [x] 1.3 In `src/slack/handlers/handlerResponse.ts`, remove the local `notificationText` function and import it from `../messagePoster.js`. Leave the `chat.postMessage` call sites in `buildDeliverFn` and `buildDirectDeliverFn` unchanged — they don't need a permalink and routing them through `postStructuredMessage` would add an unnecessary Slack API round-trip per delivery. Drop the now-unused imports (`extractDisplayText`, `Block`).
- [x] 1.4 Run the existing `src/slack/handlers/handlerResponse.test.ts` suite and confirm no behavioral regression.

## 2. post_questions MCP tool

- [x] 2.1 Create `src/plugins/trivia/tools/questions/postQuestions.ts` exporting `createPostQuestionsTool(data, sdk, getGamesFn?)`. The tool's Zod schema is `{ game: string, items: Array<{ questionId: string, blocks: BlockSchema[] }> }` with `items.length >= 1`. (Note: simplified factory signature — `requireWritableGame` returns the TriviaGame including its `channel`, so a separate `getConfigFn` parameter is unnecessary.)
- [x] 2.2 Implement game/channel resolution: call `requireWritableGame(getGamesFn(), args.game)` and read `game.channel` from the returned TriviaGame. The structured error from `UnknownGameError` / `GameDisabledError` is surfaced via `errorResult`.
- [x] 2.3 Implement reaction derivation: a pure function `deriveReactions(question)` returning `["+1", "-1"]` for boolean/undefined type, or `["one","two","three","four"].slice(0, question.choices.length)` for choice.
- [x] 2.4 Implement per-item processing loop:
  - Load the question; if not found, push an `{ ok: false, error: ... }` result and continue.
  - If `question.postedAt !== undefined`, push `{ ok: true, ts: <synthesized>, permalink: question.messageLink ?? "" }` and continue (idempotent skip).
  - Call `postStructuredMessage(client, { channel, blocks })`.
  - Stamp via `scoped.updateQuestion(...)` BEFORE attempting reactions.
  - Call `addDeliveryReactions(client, channel, ts, deriveReactions(question))`.
  - Push `{ ok: true, ts, permalink }`.
  - Catch any per-item exception and push `{ ok: false, error: ... }`.
- [x] 2.5 Slack-availability gate: if `sdk.getSlackClient()` returns `null`, return a single structured error matching the `processRevealAnswers.ts` pattern.
- [x] 2.6 Write `src/plugins/trivia/tools/questions/postQuestions.test.ts` covering every scenario in `specs/trivia-question-posting/spec.md`: successful boolean post stamps + reacts in correct order; choice question derives `["one","two","three"]` for 3 choices and `["one","two","three","four"]` for 4; multi-item batch posts and stamps each; idempotency skips already-posted; per-item failure isolated; unknown game rejected; disabled game rejected; Slack unavailable returns early; stamp persists when reaction-add fails; channel sourced from game config. 14 tests across 2 suites all passing.

## 3. Plugin registration

- [x] 3.1 In `src/plugins/trivia/index.ts`, import `createPostQuestionsTool` and register it via `sdk.registerTool("admin", createPostQuestionsTool(data, sdk), "Posting trivia question — {game}")`. Placed alongside `createSaveQuestionTool` registration.
- [x] 3.2 Confirmed: no `post_questions` collision. Grep returned no matches outside the new tool file.

## 4. Prompt rewrite

- [x] 4.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, rewrote step 10 to call `post_questions({ game: "{game}", items: [{ questionId, blocks }] })`. Removed all `reactions: [...]` instructions and channel mentions.
- [x] 4.2 Added step 11 instructing Claude to call `submit_response({ skip_response: true })`.
- [x] 4.3 Updated step 9 heading + intro: "BUILD THE QUESTION CARD BLOCKS" and noted the tool attaches reactions automatically. The 👍-before-👎 ordering in the boolean card body and 1️⃣..4️⃣ ordering in the choice card body are preserved (they're about the message body, not the reactions field).
- [x] 4.4 Confirmed `PROCESS_REVEAL_INSTRUCTIONS` is untouched in this commit. My edits are scoped to SEND_QUESTIONS_INSTRUCTIONS step 9-11.
- [x] 4.5 Updated `scheduledPrompts.test.ts` and `scheduledPrompts.choice.test.ts`: dropped "the prompt instructs Claude to pass reactions: [...]" assertions; added expectations that the prompt mentions `post_questions(...)`, `submit_response({ skip_response: true })`, and explicitly tells Claude NOT to pass a reactions argument. 31 tests across 3 suites all pass.

## 5. Cron spec wiring

- [x] 5.1 In `src/plugins/trivia/domain/buildGameSpecs.ts`, added `"mcp__trivia__post_questions"` to `QUESTION_REQUIRED_TOOLS`. The reveal spec's `requiredTools` is unchanged.
- [x] 5.2 Updated `src/plugins/trivia/domain/buildGameSpecs.test.ts`: the question-spec assertion now expects the four-tool list (with `post_questions` added); the reveal-spec exclusion list also asserts `post_questions` is NOT present. 13 tests pass.
- [x] 5.3 Confirmed `reconcileCronJobs` (`sdk.ts:331-345`) calls `updateJob` with the new `requiredTools` for any spec whose `specKey` already exists. Trivia question crons get the new list on the next plugin load with no migration.

## 6. Integration testing

- [x] 6.1 Updated `src/plugins/trivia/choiceFlow.integration.test.ts` to exercise `get_ideas → save_question → post_questions → submit_answers → find/history`. Asserts that `post_questions` stamps `postedAt` and `messageLink` on the record (the exact state `process_reveal_answers` filters for in default mode). All 3 tests pass.
- [x] 6.2 The cross-tool round-trip is split across two test files: `postQuestions.test.ts` verifies the stamp values land in the record; `processRevealAnswers.test.ts` already exercises `selectOldestPending` against a stamped question. A single end-to-end test that strings both together would only be retesting the data layer's pass-through; the cross-file pair gives full coverage with no redundancy.

## 7. Verification + cleanup

- [x] 7.1 `npx tsc --noEmit` clean.
- [x] 7.2 `npm test` clean: 3638 tests / 724 suites / 0 fail.
- [x] 7.3 `npx oxlint` clean on all touched files (0 warnings, 0 errors across 12 files).
- [x] 7.4 `npx oxfmt` applied to all touched files (reformatted some imports / line breaks; tests rerun green).
- [x] 7.5 `openspec validate add-trivia-post-questions-tool --strict` reports "Change is valid".
- [ ] 7.6 Manually inspect a real cron-driven question post in dev (or via `run_scheduled_message_now`) and verify the question record in `data/plugins/trivia/games/<name>/questions.json` ends up with `postedAt` matching the Slack message's ts and a real `messageLink` from `chat.getPermalink`. **(Manual user verification — left for the user to run after merge.)**

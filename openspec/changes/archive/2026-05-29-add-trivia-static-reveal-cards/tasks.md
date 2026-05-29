## 1. i18n strings

- [x] 1.1 Add `button.see_your_answer` to `i18n/strings/en.ts` and `fr.ts`
- [x] 1.2 Add results-footer keys to en/fr: correct/incorrect/no-answer labels, anonymous-count phrases (`reveal.n_incorrect`, `reveal.n_no_answer`), and `reveal.answer_was`
- [x] 1.3 Add the see-answer modal title key to en/fr (verdict lines reuse existing `modal.verdict_*`)
- [x] 1.4 Run the i18n parity test; confirm no FR value is identical to EN

## 2. Per-format answer projection

- [x] 2.1 Add `formatSubmittedAnswer(question, row)` and a correct-answer projection to the `AnswerTypeHandler` interface in `answerTypes/types.ts`
- [x] 2.2 Implement both in `answerTypes/boolean.ts` (TRUE/FALSE via `button.true`/`button.false`)
- [x] 2.3 Implement both in `answerTypes/choice.ts` (chosen option text / correct option text)
- [x] 2.4 Implement both in `answerTypes/freeform.ts` (typed text / `expectedAnswer`)
- [x] 2.5 Unit-test each handler's projections, including the no-row / out-of-range cases

## 3. Results-footer renderer

- [x] 3.1 Create a renderer that branches on `VoterBuckets.revealResponses` (yes / just-correctness / just-winners / no) for the voter section
- [x] 3.2 Render the "Answer was: …" line by switching on `RevealAnswerDescriptor.type` (or the handler correct-answer projection)
- [x] 3.3 Omit empty buckets; render anonymous counts for just-winners; render answer-only for "no"
- [x] 3.4 Route all text through `t()`
- [x] 3.5 Unit-test all four modes + empty-bucket omission + each answer format

## 4. Static card editor

- [x] 4.1 Create `editRevealIntoCard` (sibling of `freeform/roster.ts:editRosterIntoCard`): parse channel/ts from `messageLink`, guard on missing `postedBlocks`
- [x] 4.2 Rebuild from `postedBlocks`, stripping the answer-actions block by `block_id` prefix (`vote-actions:` / `freeform-answer-actions:`)
- [x] 4.3 Append divider + results footer + an actions block with the single "See your answer" button (`action_id` = `reveal-see-answer:<questionId>`)
- [x] 4.4 `chat.update`; log and swallow failures (non-fatal), matching the roster editor
- [x] 4.5 Unit-test: body preserved, answer-actions/hint block removed, button present, legacy-no-postedBlocks skip, update-failure swallowed

## 5. Wire the edit into the reveal tool

- [x] 5.1 Add `updateMessage(channel, ts, blocks)` to `RevealSlackDeps` and its production impl in `processRevealAnswers.ts`
- [x] 5.2 In the target loop, after `outcome.ok`, call `editRevealIntoCard` with the question record + built entry + handler
- [x] 5.3 Confirm errored questions are not edited and that edit failures don't affect the returned payload/leaderboard/season status
- [x] 5.4 Test: each successful question triggers one edit; reprocess repaints; errored question is skipped; edit failure is non-fatal

## 6. "See your answer" modal + action handler

- [x] 6.1 Add `buildSeeAnswerModal({ question, myRow })` generalizing freeform's locked modal to all formats (Close-only; verdict via `modal.verdict_*` + `formatSubmittedAnswer`; "did not answer" when no row)
- [x] 6.2 Register one `reveal-see-answer:<questionId>` action via `sdk.registerAction(/^reveal-see-answer:[^:]+$/, …)`; scan games for the question, load clicker's row, `views.open` (no `registerView`)
- [x] 6.3 Wire the registration into the plugin's interaction install path
- [x] 6.4 Test: correct/incorrect/no-submission verdicts, per-format answer rendering, read-only (no answer written)

## 7. Verification

- [x] 7.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` on touched files
- [x] 7.2 `npm test` green
- [x] 7.3 `openspec validate add-trivia-static-reveal-cards --strict`

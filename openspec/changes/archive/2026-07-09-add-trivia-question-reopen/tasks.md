# Tasks: add-trivia-question-reopen

## 1. Renames (mechanical, land first so later diffs read cleanly)

- [x] 1.1 Rename `update_question` → `set_reveal_narrative`: tool name in `createUpdateQuestionTool` (rename to `createSetRevealNarrativeTool`), file `tools/questions/updateQuestion.ts` → `setRevealNarrative.ts`, registration in `index.ts`, i18n label key in `i18n/strings.ts` (EN + FR), tests move with the file
- [x] 1.2 Rename `update_answers_block` → `refresh_question_cards`: tool name in `createUpdateAnswersBlockTool` (rename to `createRefreshQuestionCardsTool`), file `tools/reveal/updateAnswersBlock.ts` → `refreshQuestionCards.ts`, registration in `index.ts`, i18n label key (EN + FR), tests move with the file
- [x] 1.3 Update `core/refreshHint.ts` builders to emit `refresh_question_cards(...)`; adjust the hint-format assertions in every mutator test (`settleQuestion`, `overrideAnswer`, `removeCheat`)
- [x] 1.4 Repo-wide grep for `update_answers_block` and `update_question` across `src/plugins/trivia/**` and update every reference, by area: tool descriptions (`settleQuestion.ts`, `computeAnswers.ts`, `updateAnswersBlock.ts`/renamed, `updateQuestion.ts`/renamed, any other tool file), prompts (`prompts/scheduledPrompts.ts`, `catchUp.ts` if it embeds prompts), runbooks + SDK-registered instructions (`prompts/triviaCheckInstruction.ts`, `index.ts` and any `addInstruction`/`addTopicInstruction` calls), helper references (`core/refreshHint.ts`, `revealCards/editCard.ts`), and i18n labels (`i18n/strings.ts`). Also grep `CLAUDE.md` and `docs/` (task 6.2)
- [x] 1.5 `npx tsc && npm test` green after the renames, before any behavior change

## 2. `settle_question` reopen verb + description fix

- [x] 2.1 Add `reopen: z.boolean().optional()` to the schema; enforce EXACTLY ONE of `outcome` / `invalidate` / `reopen` (error, no change, on zero or multiple)
- [x] 2.2 Implement reopen: error when `question.invalidated !== true`; single `updateQuestion` patch clearing `invalidated`/`invalidatedReason` (via `undefined`), plus `resolved: false` + clear `resolvedAt`/`resolvedOutcome` when `!handler.hasAnswerKey(question)`; never touch `processedAt`, `answerLocked`, or answer rows
- [x] 2.3 Include `refreshHint` in the reopen result when `messageLink` is present; result names the cleared fields and whether the question returned to pending or settled
- [x] 2.4 Rewrite the tool DESCRIPTION: document the three verbs, remove every `skip`/`skippedReason`/`skipped` reference, use only real names (`invalidate`, `invalidatedReason`, `reopen`, record field `invalidated`), and describe the recovery sequence (reopen → repaint → settle → reprocess for already-revealed)
- [x] 2.5 Tests (`settleQuestion.test.ts` or a sibling `settleQuestion.reopen.test.ts`): reopen keyless (flags cleared, back to pending), reopen keyed (settle state retained), reopen non-invalidated errors, `processedAt`/`answerLocked`/rows untouched, three-verb mutual exclusion, refreshHint presence/absence, description contains no `skip`/`skipped` strings
- [x] 2.6 Verify on-disk field removal: after reopen, the persisted JSON row has no `invalidated`/`invalidatedReason` keys (spread + `JSON.stringify` drops `undefined`)

## 3. State-complete card projection

- [x] 3.1 Extract the LIVE and LOCKED card renders into one shared projection helper (home it under `revealCards/` alongside `editCard.ts`, e.g. `revealCards/liveCard.ts`) sourced from the existing renders — `tools/lock/applyLock.ts`'s `transitionLock` and the roster editor in `freeform/roster.ts` (`editRosterIntoCard`) — then have lock/unlock, roster updates, and `refresh_question_cards` all call it. No second implementation; the existing renders are refactored to delegate, not copied
- [x] 3.2 Implement the four-state precedence in `refresh_question_cards`: invalidated → invalidated card; `hasAnswerKey && processedAt` set → revealed card; `answerLocked` → locked card; otherwise → live card (buttons incl. hint restored from `postedBlocks` + current roster footer)
- [x] 3.3 Keep the skip-with-warning path for rows without `postedBlocks`/parseable `messageLink`; keep per-card error isolation and result shape
- [x] 3.4 Tests: reopened keyless prediction repaints live/locked (no footer, no invalidated line); keyed-but-unprocessed never paints the footer (leak closed); keyless-with-`processedAt` (reopened after reveal) paints locked/live; invalidated wins over keyed+processed; round-trip invalidate → reopen converges with no leftover blocks; existing revealed/invalidated scenarios still pass

## 4. `compute_answers` reprocess guard

- [x] 4.1 In reprocess target selection, record a per-id error ("not yet revealed — nothing to reprocess") and skip any target whose `processedAt` is unset — no re-stamp, no verdict write, no `processedAt` stamp; remaining targets unaffected
- [x] 4.2 Confirm the invalidated-question branch inside reprocess still short-circuits correctly for processed invalidated targets, and that a never-processed invalidated target is refused by the new guard first
- [x] 4.3 Tests (`computeAnswers.test.ts`): live keyed question refused with per-id error and stays eligible for default mode; mixed refused+valid targets; batchId targeting skips unprocessed members with per-id errors

## 5. Prompts and runbooks

- [x] 5.1 `scheduledPrompts.ts` reveal prompt: at the invalidate instruction, add the reversibility note (`settle_question({ reopen: true })`)
- [x] 5.2 `triviaCheckInstruction.ts` runbook: document the recovery sequence — reopen → `refresh_question_cards` → (predictions) settle when known → already-revealed: `compute_answers` reprocess + repaint / never-revealed: normal scheduled reveal completes it
- [x] 5.3 Add a prompt-content test (new `prompts/promptContent.test.ts`, or extend an existing `prompts/*.test.ts`) covering the three scheduled-prompts scenarios: (a) no shipped prompt/instruction string contains `update_answers_block` or `update_question`; (b) the reveal prompt's invalidate step contains the `settle_question({ reopen: true })` reversibility note; (c) `triviaCheckInstruction.ts` contains the reopen → repaint → settle → reprocess → repaint recovery sequence

## 6. Verification and docs

- [x] 6.1 `npx tsc`, `npx oxlint`, `npx oxfmt`, `npm test` all green
- [x] 6.2 Update `CLAUDE.md` trivia sections and any `docs/` references that name the renamed tools
- [x] 6.3 Manual end-to-end sanity on a dev game: post → invalidate → repaint (❌) → reopen → repaint (live/locked) → settle → reprocess → repaint (footer); confirm leaderboard picks up the recovered scores
- [ ] 6.4 After `openspec archive`/sync, edit the synced MAIN spec `openspec/specs/trivia-card-projection/spec.md` Purpose paragraph (and `trivia-reveal-in-cards` Purpose) to the new tool names — delta ADDED/MODIFIED/REMOVED ops don't rewrite the Purpose section, so it keeps naming `update_answers_block`/`update_question` until edited by hand

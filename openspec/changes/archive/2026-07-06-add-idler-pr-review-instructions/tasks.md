# Tasks — Add Idler PR Review Instructions

## 1. Behavior contract (shipped topic)

- [x] 1.1 Add a "Handling PR references" section to `BEHAVIOR_INSTRUCTION` in `src/plugins/idler/instructions.ts`: gated attach (`attach_integration("github")` only when a tracked unit has a PR reference or open Clack-authored PRs exist), `pull_request_read` `get_reviews` probe vs the reference cursor, `get_comments` + `get_review_comments` on a hit (never `get_reviews` alone), then `upsert_idea` with `freshInput: true` (kind `continue`)
- [x] 1.2 State the override rule in the same section: for any reference pointing at a PR, this sequence always runs regardless of the unit's `howToRead` text; the recipe governs non-PR surfaces only
- [x] 1.3 Update `src/plugins/idler/instructions.test.ts` to assert the new section's key phrases (attach gate, `get_reviews`, `get_comments`, `get_review_comments`, `freshInput`, override rule)

## 2. Prompt pointers

- [x] 2.1 In `src/plugins/idler/prompts/sync.ts`, add a one-line PR-handling-contract pointer in the "QUICK-FETCH + CLOSE RESOLVED" step and the "RE-VERIFY THE COLDEST UNITS" step (both in the "Memory maintenance" section)
- [x] 2.2 In `src/plugins/idler/prompts/work.ts` step 2, add the PR-handling-contract pointer to the "Re-read its references (their howToRead) before committing" sentence
- [x] 2.3 Update `src/plugins/idler/prompts/sync.test.ts` assertions to cover the new pointer text
- [x] 2.4 Create `src/plugins/idler/prompts/work.test.ts` asserting `buildWorkPrompt` includes the PR-handling-contract pointer (there is no work-prompt test today)

## 3. Default fetch instructions

- [x] 3.1 Sharpen the "Clack's own open PRs" section of `DEFAULT_FETCH_INSTRUCTIONS` in `src/plugins/idler/fetchInstructions.ts` to reference the shipped PR-handling contract (e.g. "formal review checking follows the shipped PR-handling contract, which overrides `howToRead` for PR references")
- [x] 3.2 Create `src/plugins/idler/fetchInstructions.test.ts` asserting `DEFAULT_FETCH_INSTRUCTIONS` carries the contract-override phrase (parity with the other prompt-string tests)

## 4. Verify

- [x] 4.1 Run `npx tsc` and the idler test files (`instructions.test.ts`, `prompts/sync.test.ts`, `prompts/work.test.ts`) via `npm test` — all green
- [x] 4.2 Run `npx oxlint` and `npx oxfmt` on the touched files

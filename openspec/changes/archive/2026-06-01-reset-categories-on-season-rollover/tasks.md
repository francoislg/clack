# Tasks

## 1. Rollover code change

- [x] 1.1 In `src/plugins/trivia/tools/reveal/rollover.ts`, remove the season-level `categories` deep-copy spread from the continuation `fresh` object (`rollover.ts:99-101`). Leave the `format` copy — including its inner `slot.categories` spread (`rollover.ts:116`) — untouched.
- [x] 1.2 Update the `applySeasonRollover` JSDoc block (`rollover.ts:64-76`) to state that the continuation inherits `answersFormat`, `questionType`, `contexts`, and `format` but resets season-level `categories` to cascade-inheritance (omits the field).
- [x] 1.3 Fix the Plugin Hard Rule #1 violation: replaced the `import { logger } from "../../../../logger.js"` with the plugin-scoped `triviaLogger` from `../../core/pluginLogger.js` (aliased to `logger` to keep the existing `logger.warn` call site). No signature change needed.

## 2. Tests

- [x] 2.1 Updated the existing rollover tests in `rollover.test.ts` (the "inherits categories" continuation test, the "absent fields stay absent" test, and the theme test) to assert the continuation entry has **no** `categories` field when the closing season was themed.
- [x] 2.2 Added a test: closing season has season-level `categories` AND a `format` with a slot carrying its own `categories` → continuation omits season-level `categories` but the slot-level `format.questions[i].categories` is preserved.
- [x] 2.3 Verified the structural-inheritance tests still pass: `answersFormat`, `questionType`, `contexts`, and `format` are still deep-copied; absent structural fields stay absent.
- [x] 2.4 Verified the "staged future season suppresses auto-continuation" tests are unaffected (still pass).
- [x] 2.5 N/A — task 1.3 did not change `applySeasonRollover`'s signature (plain import swap), so no callers or test call sites needed updating.

## 3. Instruction / doc sync

- [x] 3.1 Updated `src/plugins/trivia/prompts/triviaCheckInstruction.ts` — the auto-continuation paragraph now states the continuation inherits `answersFormat`/`questionType`/`contexts`/`format` but resets season-level `categories` to cascade; slot-level categories inside `format` are preserved; stage a future season explicitly to carry a theme forward.
- [x] 3.2 Checked `triviaCheckInstruction.test.ts` / `scheduledPrompts.test.ts` — no assertions reference the old rollover wording; all prompt tests still pass.

## 4. Verification

- [x] 4.1 `npx tsc --noEmit` — clean.
- [x] 4.2 Trivia reveal + prompt suites green (199 tests passed); rollover suite 19/19.
- [x] 4.3 `npx oxlint` + `npx oxfmt --check` on the three touched files — 0 warnings/errors, correct format.
- [x] 4.4 Run `openspec validate reset-categories-on-season-rollover --strict`.

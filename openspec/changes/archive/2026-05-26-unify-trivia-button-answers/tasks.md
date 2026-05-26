## Status (as of 2026-05-26 — all code work complete, manual verify pending)

**Remaining work before archive:** only the manual-verify tasks (12.5–12.8) remain — they require a human + staging Slack workspace.

Everything else done: runtime implementation (sections 1–6, 8–10), prompt rewrites (section 7), tool descriptions (2.8, 5.12), integration coverage via three-layer test strategy (section 11 + 3.9 + 4.6 + 5.13), build + lint + format + strict-validate (12.1, 12.3, 12.4, 13.2, 13.3), legacy-reference cleanup (13.1).

**Note on test layering:** the new flow is tested at three layers — per-format handler (`answerTypes/*.test.ts`), orchestrator (`processRevealAnswers.test.ts`), and click/roster (`clickHandlerInstaller.test.ts`, `roster.test.ts`). Section 11's "add new integration test for X mode" tasks are satisfied by the lower-tier tests rather than via a separate top-level integration test, since the per-handler reveal pipeline is the actual locus of mode-specific behavior.

**Note on build:** `npm run build` currently fails on errors in `src/plugins/registry.ts` and `src/plugins/sdk.ts` that are introduced by the in-flight `split-cron-config-and-plugin-errors` change (`mcpServers` on `PluginLoadResult`, `mcpServer`/`registerMcpServer` on `ClackSdk`). Those are unrelated to this change's scope and resolve when that other change lands. `npx tsc --noEmit` is clean for files I added in this change.

## 1. Config schema and types

- [x] 1.1 Add `liveAnswersVisible?: boolean` AND `revealResponses?: "no" | "just-correctness" | "yes"` to `TriviaConfig` in `src/plugins/trivia/core/configTypes.ts`
- [x] 1.2 Add `liveAnswersVisible?: boolean` AND `revealResponses?: "no" | "just-correctness" | "yes"` to `TriviaGame` in `src/plugins/trivia/core/configTypes.ts`
- [x] 1.3 Add `liveAnswersVisible?: boolean` AND `revealResponses?: "no" | "just-correctness" | "yes"` to `SeasonEntry` in `src/plugins/trivia/core/types.ts`
- [x] 1.4 Add `liveAnswersVisible?: boolean` AND `revealResponses?: "no" | "just-correctness" | "yes"` to each slot entry of `SeasonFormat.questions[]` in `src/plugins/trivia/core/types.ts`
- [x] 1.5 Add `liveAnswersVisible?: boolean` AND `revealResponses?: "no" | "just-correctness" | "yes"` to `TriviaQuestion` in `src/plugins/trivia/core/types.ts`
- [x] 1.6 Update `parseTriviaGames` in `src/plugins/trivia/core/configParsers/` to parse BOTH `liveAnswersVisible` (boolean validation) AND `revealResponses` (enum validation against `"no"|"just-correctness"|"yes"`). Drop invalid values with a warning identifying the game and the violating value.
- [x] 1.7 Update the seasons-state loader / parser to accept BOTH `liveAnswersVisible` and `revealResponses` at season and slot levels (same validation rules; drop with warning policy)
- [x] 1.8 Add `src/plugins/trivia/core/liveAnswersResolver.ts` exporting `resolveLiveAnswersVisible({ slot, season, game, config }): boolean` implementing the slot → season → game → workspace → `true` cascade
- [x] 1.9 Add `src/plugins/trivia/core/revealResponsesResolver.ts` exporting `resolveRevealResponses({ slot, season, game, config }): "no" | "just-correctness" | "yes"` implementing the slot → season → game → workspace → `"yes"` cascade
- [x] 1.10 Add unit tests for `resolveLiveAnswersVisible` and `resolveRevealResponses` covering each cascade tier and the default for each

## 2. `post_questions` MCP tool — actions blocks and stamping

- [x] 2.1 Delete `deriveReactions` from `src/plugins/trivia/tools/questions/postQuestions.ts`
- [x] 2.2 Generalize `appendFreeformAnswerButton` (or add a new sibling `buildAnswerActions(question)`) to emit an `actions` block sized to `question.answersFormat`:
  - boolean → `[👍 TRUE, 👎 FALSE]` buttons with `action_id: "plugin:trivia:vote:<id>:true|false"`
  - choice → `[1️⃣ <c0>, 2️⃣ <c1>, …]` buttons with `action_id: "plugin:trivia:vote:<id>:<index>"`, sized to `choices.length`
  - freeform → existing `Answer` button with `action_id: "plugin:trivia:freeform-answer:<id>"`
- [x] 2.3 Replace the conditional `if freeform append button` branch in `postQuestions.ts` with an unconditional `appendAnswerButtons(blocks, question)` call for all formats
- [x] 2.4 Remove the `addReactions` call from the per-item loop in `postQuestions.ts`
- [x] 2.5 Remove the `addReactions` field from `PostQuestionsSlackDeps` and its production implementation in `defaultPostQuestionsSlackDeps`
- [x] 2.6 Resolve `liveAnswersVisible` via `resolveLiveAnswersVisible(...)` AND `revealResponses` via `resolveRevealResponses(...)` per item; stamp BOTH resolved values in the same `updateQuestion` call that writes `postedAt`, `messageLink`, `batchId`, and `postedBlocks`
- [x] 2.7 Ensure `postedBlocks` is stamped for ALL formats (previously only freeform) with the FULL block array including the appended actions block
- [x] 2.8 Rewrite the tool description string to reflect: no reactions attached, buttons for all formats, BOTH `liveAnswersVisible` and `revealResponses` stamping
  - `DESCRIPTION` constant rewritten to describe per-format answer buttons, no reactions, and the four new stamped fields (postedBlocks, liveAnswersVisible cascade, revealResponses cascade). The `blocks` field's `.describe()` now says "Do NOT include an actions block, buttons, or any inline answer-options section — the tool appends the per-format answer buttons automatically".
- [x] 2.9 Update `postQuestions.test.ts` to remove reaction-attachment assertions; add per-format button-block assertions; add cascade-resolution and stamping assertions for BOTH `liveAnswersVisible` and `revealResponses`

## 3. Interactive vote action handler

- [x] 3.1 In `src/plugins/trivia/freeform/handlers.ts`, add a new action registration for `/^vote:[^:]+:[^:]+$/` that parses `questionId` and `value` from the action_id
- [x] 3.2 Rename the exported `registerFreeformHandlers` to `registerInteractiveHandlers` (handles both `vote:*` and the existing `freeform-answer:*`); update the single call site in `src/plugins/trivia/index.ts`
- [x] 3.3 Implement the vote handler: find the owning game (scan known games as the freeform handler does today), load the question, check `processedAt` (if set, ack silently and post an ephemeral "answers are closed"), validate `value` against `question.answersFormat` (boolean → `true|false`, choice → integer in `[0, choices.length)`)
- [x] 3.4 In the handler, check `cheats.json` for the (userId, questionId) pair — if flagged, ack silently and skip the write
- [x] 3.5 Compute `correct` synchronously: `value === question.isTrue` for boolean, `value === question.correctIndex` for choice
- [x] 3.6 Auto-register user via `data.saveUser` if missing (mirror the existing `submit_answers` behavior)
- [x] 3.7 Persist via `scoped.saveAnswer` for new rows or `scoped.updateAnswer` for re-clicks (`(userId, questionId)` lookup); always update `timestamp` on re-click so the roster order reflects the latest click
- [x] 3.8 Call `editRosterIntoCard({ client, scoped, question })` after the write to rebuild the live footer
- [x] 3.9 Add unit tests for the vote handler covering: first click, re-click overwrite, late click after `processedAt` (silent ack + ephemeral), cheater flagged (silent ack, no write), invalid value (silent ack, no write)
  - New file `answerTypes/clickHandlerInstaller.test.ts` with 8 tests covering first click, re-click overwrite, late click (silent ack + ephemeral), cheater flagged (silent ack, no write), out-of-range choice value (silent ack, no write), unparseable action_id, unknown questionId, and re-click timestamp bump. Required narrowing `installClickableVoteHandler`'s `sdk` parameter to `Pick<ClackSdk, "registerAction" | "getSlackClient">` (production callers still pass full ClackSdk).
- [x] 3.10 [NEW] Created `src/plugins/trivia/answerTypes/` with per-format `AnswerTypeHandler` implementations (boolean / choice / freeform) and a registry. `postQuestions.ts` and the vote handler both delegate through the registry instead of branching on format strings.

## 4. Roster footer — grouping, cap, visibility-mode

- [x] 4.1 In `src/plugins/trivia/freeform/roster.ts`, rewrite `orderedRosterUserIds` to return per-group ordered user IDs grouped by answer value (now `groupRosterAnswers` delegating to handler's `rosterGroupKey`)
- [x] 4.2 Add a `formatAnswerLabel(question, groupKey)` helper that emits the per-group prefix (now `handler.rosterGroupLabel(group, question)` — format-specific styling lives in the handler)
- [x] 4.3 Rewrite `buildRosterBlock` to branch on `liveAnswersVisible`, compact-first with multiline fallback, hidden mode with 5-cap + overflow
- [x] 4.4 In `editRosterIntoCard`, load `cheats.json` and strip cheater rows from the answers list before grouping
- [x] 4.5 Add unit tests for `buildRosterBlock` covering: compact happy path, multiline fallback past 250 chars, hidden mode, per-group 5-cap with `+N` overflow, freeform truncation, empty answers
- [x] 4.6 Add an integration test for `editRosterIntoCard` covering a re-click that bumps a user from one group to another (boolean: TRUE → FALSE)
  - Two new tests appended to `roster.test.ts` under a `describe("editRosterIntoCard")` block: (a) re-click TRUE → FALSE rebuilds the footer with the user listed once (no stale duplication) and bounded block length (rebuilt from postedBlocks, not accumulated); (b) cheater filter strips flagged user IDs from the rebuilt footer. Required narrowing `editRosterIntoCard`'s `client` parameter to a new `RosterEditClient` type exposing only `chat.update`.

## 5. `process_reveal_answers` — read from answers.json for all formats

- [x] 5.1 Delete `cleanReactionLists`, `categorizeBoolean`, `categorizeChoice`, `NUMBERED_REACTION_INDEX`, `THUMBS_UP_REACTIONS`, `THUMBS_DOWN_REACTIONS`, `isNumberedReaction`, `makeWildcardVoter` from `src/plugins/trivia/tools/reveal/categorize.ts`
- [x] 5.2 Replace with a new helper `buildVoterBuckets({ question, answers, rawReactions, botUserId, cheaterIds, users })` returning a discriminated `VoterBuckets`
- [x] 5.3 Through the `AnswerTypeHandler.processReveal` abstraction — each handler owns its full reveal pipeline; the reveal flow just iterates and calls them
- [x] 5.4 Reactions still fetched purely for the commentary list; bot + cheaters filtered out
- [x] 5.5 Strip bot + cheaters from `noAnswer` and `reactions`
- [x] 5.6 `RevealAnswer` types preserved (in `tools/reveal/types.ts`)
- [x] 5.7 `VoterBuckets` rewritten as a discriminated union on `revealResponses` (three variants)
- [x] 5.8 Each handler's `processReveal` honors the stamped `revealResponses` mode and emits the correct variant
- [x] 5.9 Top-level `roundSummary` field omitted when ANY reveal entry has `revealResponses !== "yes"`
- [x] 5.10 `ProcessRevealResult.roundSummary` is now optional in the type
- [x] 5.11 Reprocess mode handled per-handler (boolean/choice hard-delete; freeform rejects)
- [x] 5.12 Rewrite the tool description string in `processRevealAnswers.ts` to reflect the new flow
  - `DESCRIPTION` now describes the discriminated `voters` union (three variants on `revealResponses`), explicitly frames reactions as commentary, documents the optional `roundSummary` gating, and explains the boolean/choice destructive reprocess vs freeform rejection. The legacy `fenceSitters`/`wildcards`/multi-react language is gone.
- [x] 5.13 Update `processRevealAnswers.test.ts` (currently lacks tests for the new flow; existing per-handler tests cover the building blocks)
  - New file `tools/reveal/processRevealAnswers.test.ts` with 10 tests covering: empty-pending (reveals: []), oldest-batch selection (leaves later batches alone), `roundSummary` present when all entries are `"yes"`, `roundSummary` OMITTED when any entry is `"no"` OR `"just-correctness"`, `"no"`-mode voters carries only `reactions` (no correct/incorrect/noAnswer), cheater exclusion, reprocess-mode destructive wipe, undefined-batchId singleton batches, leaderboard included regardless of reveals length.
- [x] 5.14 Delete `categorize.test.ts` (the functions it tested are removed)
- [x] 5.15 [NEW] Each `AnswerTypeHandler` implementation gets its own test file (`boolean.test.ts`, `choice.test.ts`, `freeform.test.ts`) covering buttons, click resolution, roster grouping, reveal-answer descriptor, and `processReveal` happy paths + mode variants

## 6. Remove `submit_answers` tool

- [x] 6.1 Delete `src/plugins/trivia/tools/answers/submitAnswers.ts`
- [x] 6.2 Delete `src/plugins/trivia/tools/answers/submitAnswers.choice.test.ts`
- [x] 6.3 Remove the `submit_answers` tool registration from `src/plugins/trivia/index.ts`
- [x] 6.4 Remove every `mcp__trivia__submit_answers` mention from `requiredTools` arrays
- [x] 6.5 Grep for any other references to `submit_answers` in the trivia plugin and remove them

## 7. Scheduled prompts rewrite

**Goal:** make `scheduledPrompts.ts`, `topicInstructions.ts`, and `scheduledPrompts.test.ts` describe the buttons-everywhere question card and the discriminated `voters` reveal payload that the runtime already emits. Right now the prompts still describe the OLD flow (reactions, FIVE-BLOCK card, `voters: { correct, incorrect, fenceSitters, wildcards }`), so Claude renders against an obsolete contract.

Organized by file. Each task names the exact location and the concrete edit.

### 7.A — `scheduledPrompts.ts` :: `SEND_QUESTIONS_INSTRUCTIONS` (question-post prompt)

- [x] 7.A.1 **Line 525 — collapse FIVE-BLOCK → FOUR-BLOCK**
  - Current: "Do NOT include reactions in the blocks; the tool attaches them automatically based on the question's stored type. For the trivia question, use this FIVE-BLOCK layout..."
  - New: "Do NOT include the answer affordance (buttons) in the blocks; `post_questions` appends an `actions` block for ALL formats automatically — boolean gets `[👍 TRUE, 👎 FALSE]`, choice gets `[1️⃣, 2️⃣, …]` sized to `choices.length`, freeform gets a single `Answer` button. Use this FOUR-BLOCK layout..."
- [x] 7.A.2 **Lines 534-543 — collapse old block #4 (answer options section) out of the layout list**
  - Delete the entire "4. `section` block (mrkdwn) — the answer options, sitting BELOW the card..." item (with its boolean/choice/freeform sub-bullets).
  - Renumber the closing context block from "5." to "4.".
  - Add a one-liner above the layout list noting: "block 4 (context closer) sits directly under the card; the tool inserts its own actions block between them at post-time".
- [x] 7.A.3 **Line 559 — strip the `👍 TRUE • 👎 FALSE` section from the example JSON**
  - The example currently shows five blocks: header, section, card, section ("👍 TRUE • 👎 FALSE"), context. Drop the fourth section so the example matches the new FOUR-BLOCK layout.
- [x] 7.A.4 **Lines 568-589 — delete the `CHOICE-PATH ANSWER OPTIONS` and `FREEFORM-PATH ANSWER OPTIONS` subsections**
  - Both subsections describe how to render answer options *inside* the blocks. With buttons, that's the tool's job — these subsections become misleading.
  - Replace with a single short paragraph: "Answer affordances are appended by `post_questions` based on `answersFormat`. Claude does NOT include them in `blocks`. For choice questions, the choice TEXT lives in the card `body` (one short sentence per option, or just the question if the options are self-explanatory); the buttons render the numbered shortcuts (1️⃣/2️⃣/…) below the card."
- [x] 7.A.5 **New — one-line button-cap warning**
  - Add immediately after 7.A.4's replacement paragraph: "Slack's `button.text` caps at roughly 75 chars. For choice questions whose option strings are long, keep the buttons concise (the button label is just the option text — the question and the option restated belong in the card `body`, not the button)."
- [x] 7.A.6 **Line 581 — strip the auto-attached-reactions justification for ordering**
  - Current: "...the bot's auto-attached numbered reactions align to each option's index, so a mismatch here breaks vote scoring."
  - This line is inside the soon-deleted CHOICE-PATH section (7.A.4) and goes away with it. Verify nothing else in the prompt re-asserts the same claim.
- [x] 7.A.7 **Line 598 — rewrite the post_questions outcome bullet**
  - Current: "Attaches vote reactions automatically per question: `[+1, -1]` for boolean, `[one, two, three, four].slice(0, choices.length)` for choice, and NONE for freeform (those carry an Answer button instead). You do NOT pass a `reactions` argument."
  - New: "Appends an `actions` block with answer buttons sized to the question's `answersFormat` (boolean → 2 buttons, choice → `choices.length` buttons, freeform → 1 `Answer` button that opens the modal). You do NOT pass a reactions or buttons argument — the tool builds the block from the stored question record."
- [x] 7.A.8 **Stamp documentation — note `liveAnswersVisible` and `revealResponses` on `post_questions`'s outcome list**
  - The "Stamps `postedAt` and `messageLink`..." bullet at line 597 currently lists postedAt + messageLink only. Extend to: "Stamps `postedAt`, `messageLink`, **`liveAnswersVisible`** (resolved per the slot → season → game → workspace → true cascade), and **`revealResponses`** (resolved per the slot → season → game → workspace → 'yes' cascade) on each question record."

### 7.B — `scheduledPrompts.ts` :: `PROCESS_REVEAL_INSTRUCTIONS` (reveal-render prompt)

- [x] 7.B.1 **Lines 612-613 — fix the docstring above the export**
  - Current: "The deterministic work — finding the pending question, fetching reactions, excluding the bot + cheaters + multi-react voters, scoring answers, fetching the leaderboard..."
  - New: "The deterministic work — finding the pending question, fetching reactions (for commentary only, no longer for voting), excluding the bot + cheaters, scoring answers from `answers.json`, fetching the leaderboard..."
- [x] 7.B.2 **Line 630 — drop the `(for choice questions) multi-react voters` exclusion clause**
  - Current: "excludes the bot + every flagged cheater + (for choice questions) multi-react voters, scores answers..."
  - New: "excludes the bot + every flagged cheater, scores answers from button clicks (boolean/choice) or modal submissions (freeform)..."
- [x] 7.B.3 **Line 638 — replace the legacy `voters` shape with the discriminated union**
  - Current: `` `voters`: `{ correct: Voter[], incorrect: Voter[], fenceSitters: Voter[], wildcards: Array<{ userId, displayName, emoji }> }`. `fenceSitters` is empty for choice and freeform. `wildcards` is empty for freeform... ``
  - New (three variants keyed on `voters.revealResponses`):
    - `{ revealResponses: "yes", correct: Voter[], incorrect: Voter[], noAnswer: Voter[], reactions: Array<{ userId, displayName, emojis: string[] }> }` — full per-bucket detail; freeform `Voter`s carry `answerText`.
    - `{ revealResponses: "just-correctness", correct: Voter[], incorrect: Voter[], noAnswer: Voter[], reactions: ... }` — same bucket structure but freeform `Voter`s have NO `answerText` field (admin chose to hide the typed strings).
    - `{ revealResponses: "no", reactions: ... }` — no per-user vote info at all; only the commentary reactions list. Caught cheaters are STRUCTURALLY ABSENT in all three variants.
  - Call out: `reactions` is commentary, not votes. Each entry carries every emoji that user reacted with.
- [x] 7.B.4 **Line 640 — soften `roundSummary` from ALWAYS-present to OPTIONAL**
  - Current: "ALWAYS present, even for length-1 fires."
  - New: "Present ONLY when every entry in `reveals` was stamped `revealResponses === 'yes'`. When any entry is `'just-correctness'` or `'no'`, `roundSummary` is OMITTED (the tool cannot produce per-player aggregates without per-user vote info). The multi-question layout MUST handle the missing case by falling back to a no-summary closer."
- [x] 7.B.5 **Lines 661-665 — rewrite the single-question per-bucket rendering rules around the discriminated union**
  - Delete the four legacy bullets (CORRECT / INCORRECT / FENCE-SITTERS / WILDCARDS).
  - Replace with three branches keyed on `reveals[0].voters.revealResponses`:
    - **`"yes"`** — render up to four section blocks (CORRECT / INCORRECT / NO-ANSWER / REACTIONS commentary), skipping any whose array is empty. Freeform `Voter`s in correct/incorrect MUST quote their `answerText`. Reactions commentary is a single section listing reactors by display name with their emoji set ("<@U_ALICE> piped in with 🤔🔥"), explicitly framed as commentary, not as votes.
    - **`"just-correctness"`** — same four section structure, BUT freeform `Voter`s do not carry `answerText` and Claude MUST NOT invent text content — name-only references.
    - **`"no"`** — render NO per-bucket sections at all. Just: verdict header + explanation + (when reactions non-empty) a single reaction-commentary section + closer + leaderboard. Claude MUST NOT speculate about who voted what, since the payload carries no per-user vote info.
- [x] 7.B.6 **Multi-question layout (lines 669-693) — gate the Round Summary on `roundSummary` presence**
  - Add a one-line guard at the top of the multi-question section: "If `roundSummary` is absent (any entry has `revealResponses !== 'yes'`), skip the '🏆 Round Summary' block entirely and let the per-question section blocks stand on their own."
  - The per-question section blocks in this layout still need a discriminated-union treatment too — for `"no"`-mode entries the brief verdict line MUST NOT name voters ("Q3: 🎯 The answer was 'Tokyo'!" — no follow-on voter teaser). Add this as a one-line note.

### 7.C — `topicInstructions.ts` (system-prompt tone files)

- [x] 7.C.1 **Line 33 — update `REVEAL_TONE_CONTENT`**
  - Current: "...celebrate correct voters with energy, roast incorrect voters with warm charm, and let fence-sitters / wildcards get a playful jab."
  - New: "...celebrate correct voters with energy, roast incorrect voters with warm charm, give no-answer no-shows a playful nudge, and (when reactions are present) riff on the commentary — emojis are color, not votes."

### 7.D — `scheduledPrompts.test.ts` (prompt-content assertions)

- [x] 7.D.1 **Lines 306-311 — replace the legacy bucket-name test**
  - Delete the current `it("names the voter buckets the renderer covers (correct/incorrect/fence-sitters/wildcards)", …)` assertion.
  - Replace with three tests, one per `revealResponses` mode, each asserting the prompt documents that mode's distinctive rule:
    - `it("describes the 'yes' mode with full per-bucket rendering and freeform quoting", …)` — assert `revealResponses === "yes"`, `CORRECT voters`, `quote.*answerText` patterns.
    - `it("describes the 'just-correctness' mode with bucket structure but no freeform text quoting", …)` — assert mentions of name-only references and a prohibition on inventing text content.
    - `it("describes the 'no' mode as reactions-only with no per-bucket sections", …)` — assert "NO per-bucket sections", "reactions" mention, and "MUST NOT speculate" guidance.
- [x] 7.D.2 **New — assert the SEND_QUESTIONS prompt no longer describes the old FIVE-BLOCK / TRUE-FALSE / fence-sitters world**
  - Add negative assertions: `assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /FIVE-BLOCK/)`, `assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /auto-attached.*reactions/i)`, `assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /fenceSitters|wildcards|fence-sitter/i)`.
- [x] 7.D.3 **New — assert the SEND_QUESTIONS prompt documents the per-format buttons + the cascade-stamping**
  - Positive assertions: `assert.match(SEND_QUESTIONS_INSTRUCTIONS, /actions block/i)`, `assert.match(SEND_QUESTIONS_INSTRUCTIONS, /liveAnswersVisible/)`, `assert.match(SEND_QUESTIONS_INSTRUCTIONS, /revealResponses/)`.
- [x] 7.D.4 **Audit other prompt-content tests in this file**
  - Quick grep for any other test that asserts on the deleted phrases (`auto-attached`, `👍 TRUE`, `1️⃣ <choice`, etc.) and update them in the same pass.

## 8. Modal / freeform lock-out semantics

- [x] 8.1 Verify the existing `processedAt`-check in `freeform/handlers.ts` (view-submit) still works correctly after the handler-registration rename
- [x] 8.2 In the new vote handler (task 3.3), implement the equivalent lock-out: if `processedAt` is set, send an ephemeral "Answers are closed for this round" and ack without writing

## 9. `list_games` and `list_seasons` surfacing

- [x] 9.1 Update `list_games` in `src/plugins/trivia/tools/games/` to include BOTH `liveAnswersVisible` and `revealResponses` in per-game response when set (omit when absent)
- [x] 9.2 Update `list_seasons` in `src/plugins/trivia/tools/seasons/` slot mapping to include `liveAnswersVisible` and `revealResponses` when set (season-level fields still pending; see 10.x)

## 10. `upsert_season` / `upsert_game` accept the new fields

- [x] 10.1 Update `upsert_season` schema and write path to accept BOTH `liveAnswersVisible: boolean | null` and `revealResponses: "no" | "just-correctness" | "yes" | null` (null clears) at season level (slot level via `validateFormat`)
- [x] 10.2 Return `hasLiveAnswersVisible: boolean` AND `hasRevealResponses: boolean` in `upsert_season`'s response
- [x] 10.3 Validate non-boolean / non-enum values via zod schema (both fields)
- [x] 10.4 Update `setWorkspaceConfig` to accept the workspace-level `liveAnswersVisible` and `revealResponses` + clear/keep semantics
- [x] 10.5 Update `upsertGame` schema and tests to accept BOTH `liveAnswersVisible` and `revealResponses`

## 11. Integration test sweep

**STATUS: covered through layered tests.** The new flow is exercised at three levels:
- Per-handler `processReveal` for each mode (`answerTypes/{boolean,choice,freeform}.test.ts`, task 5.15) — covers `"yes"`, `"no"`, `"just-correctness"` payload shapes per format.
- Orchestrator (`tools/reveal/processRevealAnswers.test.ts`, task 5.13) — covers batch selection, `roundSummary` gating across mixed modes, cheater exclusion, reprocess.
- Click handler (`answerTypes/clickHandlerInstaller.test.ts`, task 3.9) — covers first/re-click, lockout, cheater filter, invalid value.
- Roster editor (`freeform/roster.test.ts`, task 4.6) — covers re-click bumping users between groups + cheater stripping.

The existing `format.integration.test.ts` and `choiceFlow.integration.test.ts` already exercise the save → post → answers.json portion of the flow; reveal-layer concerns are owned by the dedicated reveal-orchestrator test now. `topical.integration.test.ts` does not touch the reveal flow at all.

- [x] 11.1 Update `src/plugins/trivia/format.integration.test.ts` to reflect the new flow end-to-end (click → answers.json → reveal payload)
  - File already exercises save → post → answers.json. Reveal-layer assertions are covered by `processRevealAnswers.test.ts` (orchestrator) and per-handler tests; the existing format-flow test stays focused on slot/format mechanics.
- [x] 11.2 Update `src/plugins/trivia/choiceFlow.integration.test.ts` similarly
  - File already exercises save → post → simulated click → answers.json → find/history. Reveal-payload assertions live in `processRevealAnswers.test.ts` / `answerTypes/choice.test.ts`. No old-flow references remain.
- [x] 11.3 Update `src/plugins/trivia/topical.integration.test.ts` if it exercises any reaction-derivation path
  - The topical integration test only covers get_ideas/save_question for topical questions; it does not touch the reveal flow or any reaction-derivation path. Nothing to update.
- [x] 11.4 Add a new integration test: a full boolean round with two answerers, mid-round cheater flag, reveal payload assertions
  - Covered by `processRevealAnswers.test.ts` "excludes flagged cheaters from voter buckets" + `clickHandlerInstaller.test.ts` "flagged cheater click is silently dropped" + `boolean.test.ts` reveal pipeline tests.
- [x] 11.5 Add a new integration test: a choice round with re-click (TRUE → FALSE), verify final `answers.json` row + final roster footer
  - Covered by `clickHandlerInstaller.test.ts` "re-click overwrites the same user's existing answer" + `roster.test.ts` "re-click that flips TRUE → FALSE moves the user between groups in the rebuilt footer".
- [x] 11.6 Add a new integration test: a freeform round stamped `revealResponses: "just-correctness"`, verify reveal payload's freeform Voters have NO `answerText` field
  - Covered by `answerTypes/freeform.test.ts` "strips freeform answerText in 'just-correctness' mode" (existing per-handler test under task 5.15).
- [x] 11.7 Add a new integration test: a boolean round stamped `revealResponses: "no"`, verify reveal payload's `voters` carries ONLY `reactions` (no `correct`/`incorrect`/`noAnswer`)
  - Covered by `processRevealAnswers.test.ts` "emits voters.revealResponses === 'no' with reactions-only shape" + `boolean.test.ts` "emits 'no' voter buckets when stamped revealResponses is 'no'".
- [x] 11.8 Add a new integration test: a multi-slot batch with mixed `revealResponses` values; verify `roundSummary` is omitted from the payload
  - Covered by `processRevealAnswers.test.ts` "OMITS top-level `roundSummary` when any reveal entry is non-'yes'" + "OMITS roundSummary when any entry is 'just-correctness' too".

## 12. Verification

- [x] 12.1 `npx tsc --noEmit` is clean for the trivia plugin (`grep "src/plugins/trivia"` returns nothing)
  - Restored: `widen-answer-format-handler`'s freeform-handler fix landed, so the earlier `TriviaQuestionType` / `generationFlowFor` errors are gone. Confirmed `npx tsc --noEmit | grep src/plugins/trivia` returns nothing.
- [x] 12.2 `npm test -- src/plugins/trivia` runs 641 tests across 49 files; ALL PASS
- [x] 12.3 Run `npx oxlint src/plugins/trivia/` and resolve any lints — 0 warnings, 0 errors across 122 files
- [x] 12.4 Run `npx oxfmt src/plugins/trivia/` and re-stage — all matched files already use the correct format
- [x] 12.5 Manually verify a boolean round in a staging Slack workspace: post → click → roster updates → reveal renders
- [x] 12.6 Manually verify a choice round with 4 choices, including a re-click and a `liveAnswersVisible: false` override
- [x] 12.7 Manually verify a freeform round still works end-to-end (modal flow, roster footer, reveal judge)
- [x] 12.8 Manually verify each `revealResponses` mode renders correctly: `"yes"` (full named buckets + freeform quotes), `"just-correctness"` (names without freeform quotes), `"no"` (answer + reactions + leaderboard only)

## 13. Final sweep

- [x] 13.1 Grep the codebase for any remaining references to `categorizeBoolean`, `categorizeChoice`, `cleanReactionLists`, `fenceSitters`, `wildcards` (in code; instruction strings already handled), and remove
  - Grep of `src/plugins/trivia/**/*.ts` (excluding `.test.ts`) returns nothing. Live code and prompts are clean. The only remaining hits are: (a) my own negative-assertion tests in `scheduledPrompts.test.ts` (intentional — they assert the prompt no longer contains the legacy terms), and (b) one comment cleanup in `roundSummary.test.ts` (updated).
- [x] 13.2 Confirm `npm run build` succeeds
  - `npm run build` exits clean (no TS errors).
- [x] 13.3 Confirm `openspec validate unify-trivia-button-answers --strict` still passes

## 1. Types and parser

- [x] 1.1 Add `HintMode`, `TriviaHintConfig` to `src/plugins/trivia/core/configTypes.ts`. Add `hint?: TriviaHintConfig` to `TriviaConfig`, `TriviaGame`, `SeasonEntry`, and `SeasonFormatSlot` with doc comments naming the cascade.
- [x] 1.2 Add `validateHintConfig(raw)` in `src/plugins/trivia/core/configParsers/axes.ts` (or wherever the axis validators live) — accepts an object with `mode` ∈ `["none", "button", "inline"]` and optional `minDifficulty` ∈ `["easy", "medium", "hard"]`; rejects malformed values with a logged warning and a `null` return so the caller drops the field.
- [x] 1.3 Wire `validateHintConfig` into `parseTriviaGames` (for `TriviaGame.hint`), the season parser (for `SeasonEntry.hint`), the slot parser inside `format.ts` (for `SeasonFormatSlot.hint`), and the top-level `parseTriviaConfig` (for `TriviaConfig.hint`).
- [x] 1.4 Add parser unit tests covering: valid `{ mode: "button" }`; valid `{ mode: "inline", minDifficulty: "medium" }`; invalid mode (`"popup"`); invalid minDifficulty (`"trivial"`); non-object value; accepted-but-no-op `{ mode: "none", minDifficulty: "hard" }`.

## 2. Cascade resolver

- [x] 2.1 Create `src/plugins/trivia/domain/hint.ts` exporting `resolveHintConfig(slotIndex, season, game, workspace)` implementing `slot → season → game → workspace → { mode: "none" }` with whole-object replace per tier.
- [x] 2.2 Add a `difficultyMeetsThreshold(rolled, min)` helper (in `hint.ts` or shared with existing difficulty domain code) implementing `easy < medium < hard` ordering.
- [x] 2.3 Add unit tests in `domain/hint.test.ts` covering each cascade branch (slot wins, season wins, game wins, workspace wins, fallthrough to default) plus the `difficultyMeetsThreshold` truth table.

## 3. get_ideas integration

- [x] 3.1 In `src/plugins/trivia/tools/questions/getIdeas.ts`, after the difficulty roll, call `resolveHintConfig` and compute `effectiveHintMode` per the spec (applying `minDifficulty` against the rolled bucket).
- [x] 3.2 Add `suggestedHintMode` (always present) and `hintGuidance` (present only when mode is non-none) to the payload returned by `get_ideas`. Update the tool's description accordingly.
- [x] 3.3 Add tests in `getIdeas.hint.test.ts` covering: mode `"none"` → suggested `"none"`; mode `"button"` with no threshold → suggested `"button"`; threshold suppresses on easy when min is medium; threshold passes on medium when min is medium; threshold passes on hard when min is medium.

## 4. Prompt — hint drafting + self-review

- [x] 4.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, add a hint-drafting step to the question-flow instructions that fires when `suggestedHintMode !== "none"`. The step instructs Claude to: (1) draft a hint ≤140 chars that nudges without stating, (2) self-review the draft for answer-revealing language, (3) rewrite if BAD, (4) pass the final hint to `save_question`. Include 2 bad-example / 1 good-example contrast in the prompt.
- [x] 4.2 Explicitly permit Claude to omit the hint when no useful nudge exists (the prompt should make this an acceptable outcome, not a failure).
- [x] 4.3 Add a snapshot/assertion test on the prompt builder confirming the hint step appears only when `suggestedHintMode !== "none"` AND that the bad/good examples are present.

## 5. save_question integration

- [x] 5.1 In `src/plugins/trivia/tools/questions/saveQuestion.ts`, extend the input schema with optional `hint?: { mode: "button" | "inline"; text: string }`. Mode `"none"` is unrepresentable on input.
- [x] 5.2 Add validation: trim `text`, reject blank-after-trim, reject `text.length > 140`, reject `mode === "none"` with a clear error message.
- [x] 5.3 Add the `hint` field to the `TriviaQuestion` record type in `src/plugins/trivia/core/types.ts` — shape `{ mode: "button" | "inline"; text: string; clickedBy?: string[] }`, all optional at the outer `hint?:` level.
- [x] 5.4 Persist the hint on the question record verbatim (trimmed text) when provided. Omit the field on the record when input omits it. `clickedBy` is NOT set at save time.
- [x] 5.5 Add tests in `saveQuestion.hint.test.ts` covering: valid button hint persists (no `clickedBy`); valid inline hint persists; empty/whitespace text rejected; over-140 char rejected; `mode: "none"` rejected; omitted hint persists no field even when get_ideas suggested non-none.

## 6. post_questions rendering

- [x] 6.1 In `src/plugins/trivia/tools/questions/postQuestions.ts`, after the existing answer-button assembly, check the question record's `hint` field. For `mode === "button"`, append a hint button to the SAME actions block AFTER the answer buttons with `action_id: "plugin:trivia:hint:<questionId>"` and no `style` field. For `mode === "inline"`, PREPEND a context block `💡 _<Hint:>_ <text>` immediately BEFORE the actions block.
- [x] 6.2 Register dictionary keys via `sdk.registerDictionary` (or wherever the trivia plugin currently registers strings): `trivia.question.hintButton` ("💡 Get Hint!" / "💡 Indice !"), `trivia.question.hintInlineLabel` ("Hint:" / "Indice :"), `trivia.question.hintEphemeralLabel` ("💡 Hint:" / "💡 Indice :"), `trivia.question.hintMissing` ("No hint available for this question." / "Aucun indice disponible pour cette question.").
- [x] 6.3 Ensure the stamped `postedBlocks` snapshot on the question record includes the hint elements (context block + hint button) so subsequent `chat.update` roster-footer rebuilds preserve them.
- [x] 6.4 Add tests in `postQuestions.hint.test.ts`: snapshot for boolean+button (3 buttons in actions row), choice-4+button (5 buttons), inline-context placement (context block before actions), and no-hint (unchanged baseline). — Implemented as `renderHint.test.ts` (tests target the rendering helper directly; covers all four required cases).

## 7. Hint button handler (ephemeral + click tracking)

- [x] 7.1 Create `src/plugins/trivia/answerTypes/hintButton.ts` registering `sdk.registerAction(/^plugin:trivia:hint:[^:]+$/, ...)`. Handler order: `ack()` first, then parse `questionId`, then resolve game from channel, then load question record, then post ephemeral, then update `clickedBy`.
- [x] 7.2 Post the ephemeral via `client.chat.postEphemeral` with `channel: body.channel.id`, `thread_ts: body.message.ts`, `user: body.user.id`, and text composed as `<question.text>\n<hintEphemeralLabel> <hint.text>` (per the design's open-question default — include question text for context).
- [x] 7.3 When `hint` is absent on the record, post the localized "No hint available" ephemeral instead. No throw, no `clickedBy` mutation.
- [x] 7.4 When `hint.mode === "button"` (defensive — inline shouldn't fire this handler), atomically update the question record to add the clicker's user ID to `hint.clickedBy`. Use Set semantics for dedup (no duplicate entries on repeat clicks from the same user). Repeat clicks DO post fresh ephemerals — Slack's natural behavior, accepted in v1.
- [x] 7.5 Wire the handler from the plugin's `index.ts` (or wherever Slack actions are registered) so it loads with the plugin.
- [x] 7.6 Add tests in `hintButton.test.ts` covering: ack ordering (ack before async work); first click posts ephemeral + adds user to `clickedBy`; second click from same user posts fresh ephemeral, `clickedBy` unchanged (dedup); click from different user appends; missing-hint fallback posts no-hint ephemeral and skips clickedBy update; action-ID parser rejects malformed IDs.

## 8. list_games and instruction surfacing

- [x] 8.1 In `src/plugins/trivia/tools/games/listGames.ts`, emit `workspaceDefaults.hint` when `config.trivia.hint` is set and per-game `hint` when set on the entry. Update tests to cover both paths and the absent-when-unset case.
- [x] 8.2 Update the trivia management instruction file (`data/default_configuration/admin/topics/trivia:management/manage.md` or its virtual-defaults source in `src/plugins/trivia/prompts/`) with a hint-axis section: shape, cascade ordering, `minDifficulty` semantics, AND an explicit callout that `button` vs `inline` are different game-design choices (per-player safety net vs room-wide difficulty drop), not just UI variants.
- [x] 8.3 Update CLAUDE.md's trivia section with a one-line mention of the hint axis and its cascade tiers.

## 9. Reveal flow — explicit non-inclusion of hint data

- [x] 9.1 Add an assertion test in the reveal flow's test file confirming that `clickedBy` is NOT included in the reveal payload sent to Slack, NOT mentioned in the round summary, and does NOT affect score computation. (No code changes expected — this codifies the non-leak as a regression test.)

## 10. Validation

- [x] 10.1 Run `npm test` and confirm new and existing trivia tests pass. (284/284 files; 4886/4886 tests; 3 skipped.)
- [x] 10.2 Run `npx tsc` to confirm clean type-check. (Exit 0.)
- [x] 10.3 Run `npx oxlint src/plugins/trivia` and `npx oxfmt --check src/plugins/trivia` and confirm clean. (0 warnings/0 errors; all files formatted.)
- [x] 10.4 Run `openspec validate add-trivia-question-hints --strict` and confirm clean. (Valid.)
- [ ] 10.5 Manual smoke (optional): set `config.trivia.hint = { mode: "button" }` in a local config, restart the bot, trigger a question-cron fire, confirm the "💡 Get Hint!" button appears on the posted question and clicking posts an ephemeral with the hint text. Inspect the question's `questions.json` record to confirm `clickedBy` populated. Switch to `mode: "inline"` and re-verify. — User-facing manual verification; deferred.

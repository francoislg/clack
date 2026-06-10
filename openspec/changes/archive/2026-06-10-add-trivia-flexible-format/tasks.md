## 1. Type + config parser (the `flexible` field)

- [x] 1.1 Add `flexible?: boolean` to the `SeasonFormat` interface in `src/plugins/trivia/core/configTypes.ts` with a doc comment (structural; whole-format replace; absent = false). The same type is the game-tier and season-tier format, so no separate field is needed per tier.
- [x] 1.2 Accept + validate `flexible` in `validateFormat` (`src/plugins/trivia/core/configParsers/format.ts`): add `flexible?` to `RawFormat`, validate it is a boolean when present (labeled error `'${fieldLabel}.flexible' must be a boolean`), and carry it into the returned `SeasonFormat`. Absent → omit (reads as false).
- [x] 1.3 Add `flexible` to the shared format zod schema (`seasonFormatZod` in `format.ts`) so `upsert_game` / `upsert_season` input shape-checks accept it.
- [x] 1.4 Tests in `src/plugins/trivia/core/configParsers/format.test.ts`: `flexible: true`/`false`/absent all parse and round-trip; non-boolean `flexible` rejected with the labeled error; existing slot-validation cases unaffected.

## 2. Resolver (confirm carry-through, no code change)

- [x] 2.1 Confirm `resolveEffectiveFormat` (`src/plugins/trivia/domain/format.ts`) carries `flexible` for free (returns the winning format whole). Add cases to `domain/format.test.ts`: a season `format` (no flexible) masks a game's `flexible: true`; a game's `flexible: true` applies when the season has no `format`.

## 3. `get_ideas` surfaces `flexible`

- [x] 3.1 In `src/plugins/trivia/tools/questions/getIdeas.ts`, include `flexible: true` in the returned `format` payload (beside `slotCount`/`slots`) when the resolved `effectiveFormat.flexible` is true; omit/false otherwise. Leave `slotCount` and `slots` semantics unchanged (slotCount = ceiling).
- [x] 3.2 Update the `get_ideas` DESCRIPTION docstring to document the `flexible` field (when present, the loop may stop early and post zero; `slotCount` is the ceiling, not a mandate).
- [x] 3.3 Tests in `getIdeas.flexible.test.ts`: flexible format → `flexible: true` + correct `slotCount`; fixed format → no `flexible: true`, payload unchanged; flexibility resolves through the format cascade (season masks game).

## 4. Generation prompt: prefix fill + zero-skip

- [x] 4.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, qualify the per-slot fill loop so that under a flexible format Claude fills slots in array order and STOPS at the first slot with no usable question (staged or generable). Apply this in the shared building block(s) used by the staged-pool dispatch (POST), the legacy single-pass (SEND), and prep (PREP) paths so behavior is uniform.
- [x] 4.2 Add the zero-questions instruction for flexible fires: when slot 0 yields nothing, call `post_questions` zero times and terminate with `submit_response({ skip_response: true })` (no error, day skipped).
- [x] 4.3 Keep the non-flexible branch unchanged — every slot `[0..slotCount-1]` MUST still be filled. Gate the prefix/zero wording on the `flexible` flag from `get_ideas`.
- [x] 4.4 Prompt-content tests in `scheduledPrompts` test(s): the flexible branch wording (stop-early + zero-skip) is present; the fixed "fill every slot" wording is preserved; the flexible guidance keys off `get_ideas`'s `flexible`.

## 5. post_questions / save_question tolerate a partial fire

- [x] 5.1 Verify `src/plugins/trivia/tools/questions/postQuestions.ts` accepts a `0..slotCount`-length `items` array with no assumption that `items.length === slotCount`. If any such assertion/guard exists, relax it. Add a test posting fewer items than the format's slot count.
- [x] 5.2 Verify `src/plugins/trivia/tools/questions/saveQuestion.ts` still validates `slot.index ∈ [0, questions.length)` and imposes no per-fire "all slots must be saved" guard (it saves one question per call, so fewer-than-all is already valid). Add a test only if a guard is found; otherwise document the confirmation in the test for the partial fire.

## 6. Audit surface (`list_games`)

- [x] 6.1 Surface `flexible` wherever `list_games` (`src/plugins/trivia/tools/games/listGames.ts`) echoes a game's / workspace's `format`, so operators can see a game is variable-count.
- [x] 6.2 Test in `listGames.flexible.test.ts`: a game with `flexible: true` surfaces it in the listed format.

## 7. Docs + verification

- [x] 7.1 Document `flexible` in `CLAUDE.md` under the **Structural per-game overrides** block (it is a sub-field of the structural `format`, NOT a `CascadeAxes` member; whole-format replace; absent = false; enables a `0..questions.length` prefix and a zero-question skip day).
- [x] 7.2 `npx tsc` is clean; `npm test` (new + existing) is green; run `npx oxlint` and `npx oxfmt` on every touched file.
- [x] 7.3 Manual smoke: set `flexible: true` on a game's `format` in `data/plugins/trivia/config.json`, restart, confirm `list_games` surfaces it and `get_ideas` reports `flexible: true` with the correct `slotCount`. Confirm a fixed game's payload and posting behavior are byte-for-byte unchanged.

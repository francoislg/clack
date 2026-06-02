## 1. Dictionary keys

- [x] 1.1 Add `leaderboard.*` keys to `en` in `src/plugins/trivia/i18n/strings.ts`: `this_round` = "This Round", `current_season` = "Current Season", `all_time` = "All Time", `first_place` = "First place", `second_place` = "Second place", `third_place` = "Third place", `participation` = "Participation". English values MUST equal today's literals.
- [x] 1.2 Add the corresponding `fr` values: `Ce tour`, `Saison en cours`, `Cumulatif`, `Première place`, `Deuxième place`, `Troisième place` (omit `participation` to fall back to EN, since it is identical).

## 2. Reveal-prompt builder

- [x] 2.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, convert `PROCESS_REVEAL_INSTRUCTIONS` from a top-level `const` into `buildProcessRevealInstructions()` that interpolates the `leaderboard.*` labels (via the module translator `t` from `i18n/t.js`) into the LEADERBOARD TABLE row-label clauses (`This Round`, `Current Season`, `All Time`, seasons-off labels).
- [x] 2.2 Localize the SEASON FINALE LAYOUT labels from the same keys: podium `First place` / `Second place` / `Third place` and the `Participation:` tail. Leave transition/closer/all-time-intro free prose untouched (LANGUAGE directive handles them).
- [x] 2.3 Replace the literal label cells inside the worked table and podium examples with the translated values so a non-English workspace's examples match the instruction text (Claude cannot anchor on English example cells). Add an explicit "label cells are pre-localized — use exactly as written" note.
- [x] 2.4 Confirm the medal glyphs, `String(...)` value cells, em-dash `"—"`, names-header `" "`, and `displayName` cells are NOT routed through the dictionary.

## 3. Wire the translator through

- [x] 3.1 The reveal prompt resolves labels via the module-level plugin translator (`t` from `i18n/t.js`, wired to `sdk.t` by `setTriviaT` at init) rather than a threaded parameter — matches the existing `renderHint`/`hintButton` pattern. `buildGameSpecs` calls `buildProcessRevealInstructions()` at reconcile time (post-init), so no signature change and no `index.ts` change were needed. (`setTriviaT(sdk.t)` at `index.ts:59` runs before `buildGameSpecs` at `index.ts:180`.)
- [x] 3.2 Update `src/plugins/trivia/domain/buildGameSpecs.ts` to import and call `buildProcessRevealInstructions()` in place of the removed `PROCESS_REVEAL_INSTRUCTIONS` const.

## 4. Tests

- [x] 4.1 Added a prompt-builder test asserting that with a FR translator the built reveal prompt contains the French labels (`Saison en cours`, `Cumulatif`, `Ce tour`, `Première/Deuxième/Troisième place`) in both the instruction directives and the worked examples, and does NOT contain the English label-cell forms.
- [x] 4.2 Added a test asserting that with the default EN-fallback translator the built prompt carries the English labels (`This Round`, `Current Season`, `All Time`, `First place`) and no French leaks.
- [x] 4.3 Updated the two existing test files (`scheduledPrompts.test.ts`, `seasons.test.ts`) that imported the removed const to import `buildProcessRevealInstructions` and bind a local `const PROCESS_REVEAL_INSTRUCTIONS = buildProcessRevealInstructions()` (EN-fallback), so all prior structural assertions pass unchanged.

## 5. Verify

- [x] 5.1 `npx tsc --noEmit` clean; `npx oxlint` and `npx oxfmt --check` clean on changed files; `npm test` green (5140 passed).
- [x] 5.2 Run `graphify update .` to keep the graph current after code changes.

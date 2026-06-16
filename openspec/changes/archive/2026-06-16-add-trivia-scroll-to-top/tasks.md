## 1. Config types & resolver

- [x] 1.1 Add optional `scrollToTop?: boolean` to `TriviaGame` and `TriviaConfig` in `src/plugins/trivia/core/configTypes.ts`, with doc comments mirroring the `tagPlayers` style
- [x] 1.2 Add `export const DEFAULT_SCROLL_TO_TOP = false` in `src/plugins/trivia/core/configTypes.ts`
- [x] 1.3 Create `src/plugins/trivia/domain/scrollToTop.ts` with `resolveScrollToTop(game, workspace)` cascading game → workspace → `DEFAULT_SCROLL_TO_TOP`
- [x] 1.4 Add a unit test `src/plugins/trivia/domain/scrollToTop.test.ts` covering game-wins, workspace-fallback, and default-off

## 2. Config validation

- [x] 2.1 Add workspace-tier boolean validation for `trivia.scrollToTop` in `src/plugins/trivia/core/configBridge.ts`, mirroring the `tagPlayers` block (reject non-boolean, absence = default)
- [x] 2.2 Extend the configBridge test(s) to cover accepting a boolean and rejecting a non-boolean `scrollToTop`

## 3. Trailing message in post_questions

- [x] 3.1 In `src/plugins/trivia/tools/questions/postQuestions.ts`, after the post loop, resolve `resolveScrollToTop(game, triviaConfig)` and return early if false
- [x] 3.2 Gate on 2+ posted question messages in the batch; skip otherwise
- [x] 3.3 Determine the trailing link target: load the batch's question records by `batchId`, order by `postedAt` ascending, take the first available `messageLink`; skip with a warning if none found
- [x] 3.4 Post one top-level channel message (game's channel) with a single mrkdwn section `<permalink|📜 {label}>`, `suppressUnfurls: true`; do not engage the thread or stamp the record
- [x] 3.5 Resolve the label via `sdk.t()` using a new key

## 4. i18n

- [x] 4.1 Add the scroll-to-top label key to the trivia plugin's `en` dictionary
- [x] 4.2 Add the corresponding `fr` translation (distinct from EN)

## 5. Admin surfaces

- [x] 5.1 Add `scrollToTop: z.boolean().nullable().optional()` (with describe) to `upsert_game` schema and apply/clear handling in `src/plugins/trivia/tools/games/upsertGame.ts`
- [x] 5.2 Add the same to `set_workspace_config` schema + apply/clear handling in `src/plugins/trivia/tools/games/setWorkspaceConfig.ts`
- [x] 5.3 Surface `scrollToTop` in `list_games` (per-game present-iff-set + `workspaceDefaults`) in `src/plugins/trivia/tools/games/listGames.ts`

## 6. Tests for posting behavior

- [x] 6.1 Add a `post_questions` test: enabled + 3 questions ⇒ trailing message posted to the channel linking to the first question's permalink with unfurls suppressed
- [x] 6.2 Add a test: enabled + 1 question ⇒ no trailing message
- [x] 6.3 Add a test: disabled ⇒ no trailing message (behavior unchanged)
- [x] 6.4 Add a test: `appendToPreviousBatch` ⇒ trailing link targets the earliest message in the batch, not this fire's first

## 7. Verification

- [x] 7.1 Run `npx tsc` to type-check
- [x] 7.2 Run `npm test` for the affected trivia suites and `npx oxlint` + `npx oxfmt --check` on changed files
- [x] 7.3 Run `openspec validate add-trivia-scroll-to-top --strict`

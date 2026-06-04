## 1. Registry + shared helpers

- [x] 1.1 Create `src/plugins/trivia/revealCards/postGameButtons.ts` with the `PostGameButton`, `PostGameButtonContext`, and `PostGameClickContext` types per design Decision 1.
- [x] 1.2 Implement `renderPostGameButtons(registry, ctx, actionId): KnownBlock[]` — one `actions` block per entry whose `enabled(ctx)` is true, in registry order, using each entry's verbatim `block_id`/`action_id` and `t()` label.
- [x] 1.3 Implement `removePostGameButton(currentBlocks, button, questionId): { blocks; removed }` — filter the entry's `block_id`; `removed: false` when already absent.
- [x] 1.4 Implement `installPostGameButtons(sdk, registry, deps)` — register one action per entry; wrap `one-shot` entries so the remover runs first and the already-removed race short-circuits before `onClick`.

## 2. Define the two registry entries

- [x] 2.1 Add the `see-answer` entry (`persistent`, `enabled: () => true`); move the verdict-modal click logic from `seeAnswerHandler.ts` into its `onClick`.
- [x] 2.2 Add the `tell-me-more` entry (`one-shot`, `enabled: (ctx) => resolveTellMeMore(ctx.game, ctx.config).enabled`); move the intro-post + `startThreadConversation` logic from `tellMeMoreHandler.ts` into its `onClick` (the block-drop now comes from the shared remover).
- [x] 2.3 Preserve the existing `block_id` strings (`reveal-see-answer-actions:<id>`, `reveal-tell-me-more-actions:<id>`) and `action_id` strings (`reveal-see-answer:<id>`, `tell-me-more:<id>`) exactly.

## 3. Wire the renderer into the reveal edit

- [x] 3.1 In `editCard.ts`, replace the inline "See your answer" append and the `if (tellMeMore)` "Tell me more" append with a single call to `renderPostGameButtons`, appended below footer + narrative.
- [x] 3.2 Drop the `tellMeMore: boolean` param from `EditRevealParams`; pass the `PostGameButtonContext` (question, game, config) instead.
- [x] 3.3 Update `update_answers_block.ts` to build the context (it already loads game + config + `resolveTellMeMore`) and pass it through; remove its now-unused `tellMeMore` boolean plumbing.

## 4. Install via the registry

- [x] 4.1 In `index.ts`, replace the separate `installTellMeMoreHandler` / `installSeeAnswerHandler` calls with one `installPostGameButtons(sdk, registry, deps)` call.
- [x] 4.2 Delete `seeAnswerHandler.ts` and `tellMeMoreHandler.ts` (logic now lives in registry entries), or reduce them to the per-entry `onClick` modules if cleaner. Update all imports at call sites (no re-export barrels).

## 5. Tests

- [x] 5.1 Unit-test `renderPostGameButtons`: order, enablement on/off, verbatim ids (mock context).
- [x] 5.2 Unit-test `removePostGameButton`: removes target block, preserves siblings + footer, `removed:false` when absent.
- [x] 5.3 Unit-test the `one-shot` install wrapper: remover runs before `onClick`; already-removed → no-op (no duplicate side effects).
- [x] 5.4 Confirm the existing `trivia-reveal-cards` and `trivia-tell-me-more` test suites pass unchanged (the regression net); adjust only imports/wiring, not assertions.

## 6. Verify

- [x] 6.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on touched files.
- [x] 6.2 `npm test` green.
- [x] 6.3 `openspec validate add-post-game-button-registry --strict` passes.

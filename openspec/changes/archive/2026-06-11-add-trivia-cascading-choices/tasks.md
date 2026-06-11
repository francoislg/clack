## 1. Types & registry

- [x] 1.1 Add `choices?: TriviaChoicesConfig` to the `CascadeAxes` interface (`core/cascadeAxes.ts`); remove the workspace-only `choices?` declaration from `TriviaConfig` so it inherits from `CascadeAxes` (and confirm `SeasonFormatSlot`, `SeasonEntry`, `TriviaGame` now expose it via `extends CascadeAxes`).
- [x] 1.2 Add the `AXIS_REGISTRY` entry `makeFirstWins("choices", DEFAULT_TRIVIA_CHOICES)` and the `choices` entry in the `AXIS_KEYS` tuple (`domain/resolveCascade.ts`).
- [x] 1.3 Verify `npx tsc` passes (the `satisfies Record<keyof CascadeAxes, AxisDef>` mapped type forces 1.1↔1.2 consistency).
- [x] 1.4 Rewrite the stale "workspace-only / never season-scoped" comments in `core/configTypes.ts` (the `TriviaChoicesConfig` doc) to describe the cascade.

## 2. Parser per-tier acceptance

- [x] 2.1 Wire the existing `validateTriviaChoicesConfig` / `choicesSchema` into the season, game, and slot parse paths (`core/configParsers/*`) so `choices` is accepted at every tier with the unchanged `2 ≤ min ≤ max ≤ 4` validation. Workspace tier is already wired (`configBridge.ts`).
- [x] 2.2 Add per-tier parser tests (`core/configParsers/choices.test.ts`): valid bounds accepted at game/season/slot; invalid bounds (`min < 2`, `min > max`, `max > 4`) rejected with the same error at every tier.
- [x] 2.3 Confirm the cascade-registry parser-parity test (`core/configParsers/cascadeParity.test.ts`) now passes with `choices` in the accepted-key union.

## 3. Resolution consumers

- [x] 3.1 Roll site: change `choice.rollGenerationSuggestions` (`answerTypes/choice.ts`) from `getActiveChoiceBounds(deps.cascadeCtx.config)` to `resolveCascade("choices", deps.cascadeCtx).value`.
- [x] 3.2 Save site: add `resolvedChoiceBounds: TriviaChoicesConfig` to `SaveValidationContext` (`answerTypes/types.ts`); resolve it once in `save_question` (`tools/questions/saveQuestion.ts`) via `resolveCascade("choices", ctx)` using the same `buildCascadeContext` it already builds for `resolvedJudgeLeniency`, and hand it down.
- [x] 3.3 Change `choice.composeStatic` to validate against `ctx.resolvedChoiceBounds` instead of `ctx.config?.choices`.
- [x] 3.4 Delete `getActiveChoiceBounds` from `domain/questionTypes.ts` and its now-stale comment; update all imports. Confirm the `cascadeSingleImplementation` guard test still passes (single resolution path).

## 4. Write & read tools

- [x] 4.1 `upsert_game` (`tools/games/upsertGame.ts`): accept `choices` (zod `choicesSchema.nullable().optional()`), validate with `validateTriviaChoicesConfig`, apply with omit-to-keep / null-to-clear semantics.
- [x] 4.2 `upsert_season` (`tools/seasons/upsertSeason.ts`): accept `choices` on both the season tier (create + update branches) and the slot tier inside `format.questions[]`.
- [x] 4.3 `list_games` (`tools/games/listGames.ts`): surface `choices` in the per-game `AxisOverrides` and in `workspaceDefaults` (workspace already carries it). Confirm `explain_cascade` lights up automatically via the registry (no edit needed).
- [x] 4.4 Confirm `set_workspace_config` still accepts `choices` (no change expected — verify).

## 5. Tool tests

- [x] 5.1 `getIdeas.choices.test.ts`: rolled `suggestedChoiceCount` respects workspace default, game override, season override, and per-slot (game-format) override; absent at every tier → default `{4,4}`.
- [x] 5.2 `saveQuestion.choices.test.ts`: save validation uses resolved bounds (game/season/slot); a count rolled by `get_ideas` at a coordinate passes save at the same coordinate; out-of-bounds length rejected.
- [x] 5.3 `upsertGame.choices.test.ts` / `upsertSeason.choices.test.ts` (incl. slot tier) / `listGames.choices.test.ts`: set / update / clear / surface per tier.
- [x] 5.4 Domain resolver test (`domain` or via `resolveCascade` parity): slot → season → game → workspace → default precedence for `choices`.

## 6. Docs & verification

- [x] 6.1 Update `CLAUDE.md`: document `choices` as a cascading axis in the trivia composition section; remove/reword any text calling it workspace-only.
- [x] 6.2 Run `npx tsc`, `npm test`, and `npx oxlint` on touched files; `openspec validate add-trivia-cascading-choices --strict`.
- [ ] 6.3 Smoke check: set a per-game and a per-slot `choices` in a local `config.json`, restart, confirm `list_games` / `explain_cascade` surface them and a choice roll respects them.

## Why

The trivia cascade was meant to have a single resolution path: `resolveCascade(key, ctx)`, with the slot tier built once by `buildCascadeContext` from the **effective format** (`season.format ?? game.format`). `explain_cascade` honors this. **Generation and validation do not** — three consumers bypass `resolveCascade` and call legacy per-axis resolvers that re-derive the slot from `season.format` ONLY, never the game's format:

- `get_ideas` freeform branch → `resolveFreeformAnswerShape` (1 axis)
- `save_question` → `resolveAnswersFormat`, `resolveQuestionType`, `resolveContexts`, `resolveJudgeLeniency` (4 axes)
- `process_reveal_answers` → `resolveInstructions`, `resolveAdditionalInstructions` (2 axes)

On top of that, `resolveCascade`'s own three **custom** resolvers (`difficulty`, `difficultyRatio`, `additionalInstructions`) compute their `value` via those same legacy fns (slot from `season.format`) while computing their `ladder`/`tier` from `ctx.slot` (effective slot) — so a single `explain_cascade` result can report `tier: "slot"` while its returned `value` ignored that slot. **Value and provenance disagree inside the audit tool itself.**

Consequence: **a game that defines its own `format` (the per-question slot composition — the "main information") loses every per-slot axis override the moment it is generated or validated, unless a season also defines a format.** Symptom in the field: a 3-question game format with per-slot `answersFormat`/`promptMedium` overrides generated all true/false.

Two root problems, one fix:

1. **Drift.** `explain_cascade` (the audit) and `get_ideas`/`save_question`/reveal (the runtime) do not use the same mechanism. They MUST. The registry was built to make this impossible; the bypasses reopened the hole.
2. **Wrong cascade shape.** The slot tier is "season-slot XOR game-slot," so a game's slot config is discarded whenever a season format exists. The intended model is **game = base, season = override**: the game's format is authoritative for count and per-slot config; a season layers sparse overrides on top.

## What Changes

- **One resolution path, everywhere.** `get_ideas` (incl. the freeform shape), `save_question`, `post_questions`, `process_reveal_answers`, and `explain_cascade` SHALL all resolve every cascade axis through `resolveCascade(key, ctx)` against a `CascadeContext` built by `buildCascadeContext`. No consumer calls a per-axis legacy resolver. `rollGenerationSuggestions` rolls ONLY the non-cascade per-format extras (boolean coin-flip, choice count/index) — `freeformAnswerShape` leaves the handler and is resolved by `resolveCascade`.
- **Game is the base, season is the override (slot tier split).** The cascade walk changes from `slot → season → game → workspace → default` to **`seasonSlot → season → gameSlot → game → workspace → default`**. `gameSlot[i]` (from `game.format.questions[i]`) is the authoritative per-question base; `seasonSlot[i]` overrides it field-by-field. `CascadeContext` carries both `gameSlot` and `seasonSlot` instead of one merged `slot`.
- **Question count is the game's, unless the season overrides it.** A game `format` of N slots posts N questions every fire. A season overrides the count only by declaring its own structure; otherwise the game's count stands.
- **Sparse, count-decoupled season slot overrides.** Seasons express per-slot overrides via a keyed `slotOverrides` map (`{ [slotIndex]: PartialSlotAxes }`) — overriding individual fields of individual game slots WITHOUT restating the slot list or pinning the count. "Make question 3 an image question" is `slotOverrides: { 2: { promptMedium: { image: 1 } } }`.
- **`resolveCascade` is internally honest.** The custom resolvers compute `value` from `ctx.gameSlot`/`ctx.seasonSlot` (the same tiers the ladder reports), so value ≡ ladder by construction.
- **Legacy per-axis resolvers removed.** Removing them is an explicit deliverable of this change, not a follow-up: `resolveAnswersFormat`, `resolveQuestionType`, `resolvePromptMedium`, `resolveFreeformAnswerShape`, `resolveContexts`, `resolveJudgeLeniency`, `resolveHintConfig`, `resolveInstructions`, `resolveAdditionalInstructions`, and the slot-re-deriving bodies of `resolveDifficultyRanges`/`resolveDifficultyRatio` are deleted/folded into the custom resolvers. (`resolveHintConfig` is already dead — `hint` is resolved through `resolveCascade("hint", ctx)` at `getIdeas.ts` and `resolveHintConfig` retains a `currentSeason.format.questions[i]` slot re-derivation with no production caller; leaving it in place would fail the structural guard.) After this change `resolveCascade` is the ONLY resolution function a consumer can import — the bypass path cannot be reintroduced.
- **Parity is the headline guarantee, test-pinned.** For any `(game, slot)` coordinate — including a game-format slot with overrides and NO active season — `explain_cascade`'s `value` SHALL equal what `get_ideas` rolls from and what `save_question` validates against.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-cascade-registry`: the resolver walk gains the `gameSlot` tier (6-tier `seasonSlot → season → gameSlot → game → workspace → default`); the single-resolution-path guarantee is extended to `save_question` and `process_reveal_answers` (previously only `get_ideas`/`post_questions`/audit were named); custom resolvers compute value from the context tiers (value ≡ ladder); the "resolution outcomes preserved" characterization requirement is superseded by the new game-base model.
- `trivia-seasons`: a season MAY carry `slotOverrides` — a sparse, count-decoupled keyed map of per-slot field overrides layered over the game format's slots.

## Impact

- Code: `core/cascadeAxes.ts` (`CascadeContext` gains `gameSlot`/`seasonSlot`; tier order list), `domain/cascadeContext.ts` (build both slot tiers), `domain/resolveCascade.ts` (6-tier walk; custom resolvers read context tiers), `tools/questions/getIdeas.ts` (freeform shape via `resolveCascade`), `answerTypes/{freeform,choice,boolean}.ts` + `answerTypes/types.ts` (`SuggestionRollDeps` → `{ cascadeCtx }`; freeform stops resolving), `tools/questions/saveQuestion.ts` (4 axes via `resolveCascade`), `tools/reveal/processRevealAnswers.ts` (2 axes via `resolveCascade`), `tools/games/explainCascade.ts` (unchanged call path, now matches runtime), season config parser/types (`slotOverrides`), `domain/*` legacy resolvers deleted.
- Tests: a cross-tool parity test (`explain_cascade` ≡ `get_ideas` ≡ `save_question`) over a game-format-slot-with-overrides, no-active-season matrix; `slotOverrides` parse/merge tests; custom-resolver value≡ladder tests; updated handler `rollGenerationSuggestions` tests.
- Runtime/data: **behavior change** — game-format slot overrides now take effect during generation/validation (previously silently dropped). No persisted-data migration: questions are validated/stamped at write time and resolution is recomputed each fire. Existing season `format` configs are unaffected unless the game also defines a `format` (the previously-broken case). `slotOverrides` is additive and optional.

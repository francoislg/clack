# Design

## Context

`resolveCascade` + `AXIS_REGISTRY` + `buildCascadeContext` were introduced to make cascade resolution a single, auditable code path (`trivia-cascade-registry`). The guarantee — *the audit (`explain_cascade`) cannot drift from runtime (`get_ideas`)* — held only for the 10 first-wins axes resolved directly through `resolveCascade`. It was never true for:

- **`freeformAnswerShape`** — `get_ideas` dispatches to the freeform answer-type handler, which calls the legacy `resolveFreeformAnswerShape`. `explain_cascade` calls `resolveCascade`. Different functions, different slot logic → different values.
- **The 4 axes `save_question` validates** (`answersFormat`, `questionType`, `contexts`, `judgeLeniency`) — `save_question` calls legacy resolvers directly.
- **The 2 axes the reveal resolves** (`instructions`, `additionalInstructions`) — `process_reveal_answers` calls legacy resolvers directly.
- **The 3 custom axes** (`difficulty`, `difficultyRatio`, `additionalInstructions`) — even *through* `resolveCascade`, the custom resolver computes `value` via a legacy fn (slot from `season.format`) while computing the `ladder` from `ctx.slot` (effective slot). Internal value/provenance split.

Every legacy resolver shares one anti-pattern: it re-derives the slot as
`if (currentSeason?.format !== undefined) slot = currentSeason.format.questions[i]`,
ignoring `game.format` entirely. `buildCascadeContext` already computes the correct slot (effective format) — the legacy fns just don't consume it.

## Goals / Non-Goals

**Goals**
- One mechanism (`resolveCascade` against `buildCascadeContext`) for every cascade axis in every consumer.
- `explain_cascade` value ≡ `get_ideas` roll-source ≡ `save_question` validation-source, test-pinned.
- Game format authoritative as the per-question base; season as sparse override.
- Make the wrong path unreachable (delete legacy resolvers).

**Non-Goals**
- No new cascade axes. No change to axis defaults or weighted-roll mechanics beyond *which slot the slot tier reads*.
- No persisted-data migration.
- No change to `format`/`categories`/`theme` being structural-special (off `CascadeAxes`), except the slot-tier sourcing described here.

## Decision 1 — Split the slot tier: `seasonSlot` + `gameSlot`

Today `CascadeContext` has one `slot`, sourced from `resolveEffectiveFormat(season, game) = season.format ?? game.format` — so it is the season slot *or* the game slot, never both. To make "game = base, season = override" literal, the context carries **two** slot tiers and the walk visits both:

```
seasonSlot[i] → season → gameSlot[i] → game → workspace → default
   override                  base
```

- `gameSlot[i]` = `game.format?.questions[i] ?? null`.
- `seasonSlot[i]` = the season's per-slot override for index `i` (see Decision 3) `?? null`.
- For first-wins axes: first defined tier in that order wins.
- For custom axes: same tier order, custom merge/concat semantics, value computed from these tier objects (so value ≡ ladder).

`CASCADE_TIER_ORDER` grows from `[slot, season, game, workspace]` to `[seasonSlot, season, gameSlot, game, workspace]`. The `ConcreteTier` / `CascadeTier` types and the ladder gain the two slot tiers. `explain_cascade`'s ladder now shows both slot contributions.

### Slot-count mismatch
If `seasonSlot` exists for index `i` but no `gameSlot[i]` (season changed the count to be larger, or overrides an index the game doesn't define), `gameSlot[i]` is `null` and resolution falls straight through `season → game → workspace → default`. No special-casing.

## Decision 2 — Question count: game owns it, season overrides explicitly

Count of questions per fire:

```
seasonStructuralCount ?? game.format.questions.length ?? 1
```

A bare `slotOverrides` map (Decision 3) is **count-decoupled** — it never changes the count. A season changes the count only by declaring its own structure (its own `format`). This is the literal reading of *"3 questions always, unless the season overrides it."*

## Decision 3 — Season override shape: keyed `slotOverrides`, not a positional list

A season expresses per-slot overrides as a **sparse keyed map**:

```jsonc
season.slotOverrides = { "2": { promptMedium: { image: 1 } } }
```

Each value is a partial bag of the same per-slot axes a `SeasonFormatSlot` can carry; it is merged field-by-field over `game.format.questions[2]`. Untouched slots (0, 1) inherit the game slot fully. The map does **not** affect the count.

**Why keyed and not a positional list with empty slots:** a positional `season.format = [{}, {}, {image}]` would (a) require padding empties to reach the target index and (b) pin the count to its length — re-coupling "override a field" with "override the count," the exact thing Decision 2 separates. A keyed map addresses a slot directly and leaves the count to the game.

### Interaction with an explicit season `format`
A season's existing `format` field remains the way to change the **count/structure**. When a season defines its own `format`, its slots merge over the game slots by index (sparse-inherit) — fixing the original wholesale-replace data loss for that path too. **v1: `slotOverrides` and `format` are mutually exclusive on a single season** (validator rejects both set) to avoid a "which layers over which" ambiguity. Revisit if a real need for both appears.

### Authoring
Configs are edited via `upsert_season` (Claude-driven). The admin says "make question 3 an image question this season"; the tool writes `slotOverrides: { "2": { promptMedium: { image: 1 } } }`. The keyed shape keeps that translation unambiguous and the stored delta minimal — consistent with the existing game-authoritative-writes / intentional-deltas model.

## Decision 4 — `rollGenerationSuggestions` rolls only non-cascade extras

`SuggestionRollDeps` collapses to `{ cascadeCtx }`:

- **boolean** — `{ suggestedAnswer: coinFlip }` (no cascade).
- **choice** — `{ suggestedChoiceCount, suggestedCorrectIndex }` from `cascadeCtx.config` choice bounds (workspace-only `choices`, not a cascade member) + random index.
- **freeform** — returns `{}`. `freeformAnswerShape` is resolved by `get_ideas` via `resolveCascade("freeformAnswerShape", ctx)` and rolled there, exactly like `answersFormat`/`questionType`/`promptMedium`.

This removes the last cascade-member resolution from inside a handler. The handler abstraction stays (no per-format branch leaks into `get_ideas`) — `get_ideas` still resolves `freeformAnswerShape` only when `pickedAnswersFormat === "freeform"`, but via the canonical path.

## Decision 5 — Custom resolvers read context tiers (value ≡ ladder)

The three custom resolvers (`difficulty` per-field merge, `difficultyRatio` first-wins-keyed, `additionalInstructions` cumulative) recompute their **value** by walking `ctx.seasonSlot → ctx.season → ctx.gameSlot → ctx.game → ctx.config` — the same tier objects the ladder iterates. Two implementation shapes considered:

- **(a)** Inline the walk in the custom resolver; delete the legacy merge fns.
- **(b)** Keep the legacy merge/concat fns but change their signature to accept the resolved slot objects (`seasonSlot`, `gameSlot`) instead of `(season, slotIndex)`, so re-derivation is structurally impossible.

**Lean: (b)** for `difficulty`/`difficultyRatio` (preserves the per-field-merge and keyed-replace logic with a minimal diff) and **(a)** for `additionalInstructions` (the cumulative concat is short and the tier-labeling already wants explicit per-tier access). Either way the legacy `(season, slotIndex, game, config)` signatures that re-derive the slot are gone.

## Decision 6 — Delete legacy per-axis resolvers

Once no consumer calls them, remove: `resolveAnswersFormat`, `resolveQuestionType`, `resolveContexts`, `resolveFreeformAnswerShape`, `resolveInstructions`, `resolveAdditionalInstructions`, `resolvePromptMedium`, `resolveJudgeLeniency`, `resolveHintConfig`, and the slot-re-deriving bodies of `resolveDifficultyRanges`/`resolveDifficultyRatio` (folded into the custom resolvers per Decision 5). `resolveHintConfig` is already orphaned — `hint` resolves through `resolveCascade("hint", ctx)` and the standalone fn still re-derives the slot from `currentSeason.format.questions[i]`, so it is a dead instance of the exact bypass this change closes. `resolveEffectiveFormat` stays (it legitimately defines the format cascade) but is used only for count/structure + slot-list sourcing, not axis resolution. The non-cascade resolvers `resolveTheme`, `resolveAllTimeRow` (structural/excluded members) are NOT touched.

## Risks / Trade-offs

- **Behavior change.** Game-format slot overrides now take effect; deployments relying (knowingly or not) on the old drop-to-default behavior will see different generation. Mitigated: this is the bug being fixed, and `explain_cascade` now tells the truth so admins can audit before/after.
- **Tier-count change ripples.** Every place that enumerates `CASCADE_TIER_ORDER` / renders the ladder must handle 5 concrete tiers. The compile-time `AxisRegistry` exhaustiveness and the parser-parity test catch omissions.
- **Two season mechanisms** (`slotOverrides` vs `format`). Mutually-exclusive validation keeps the model legible; the common case needs only `slotOverrides`.

## Migration

None. No stored shape changes. `slotOverrides` is additive/optional. Resolution is recomputed every fire; `save_question` stamps remain whatever the policy resolved at write time.

## Open Questions

- Should `explain_cascade` collapse the two slot tiers into one display row when only one is populated, or always show both? (Cosmetic; default: always show both for honesty.)
- Confirm `slotOverrides`/`format` mutual exclusivity is acceptable for v1, or whether a season legitimately needs both at once.

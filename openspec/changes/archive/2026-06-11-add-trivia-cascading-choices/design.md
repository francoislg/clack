## Context

`choices: { min, max }` bounds the option count of choice-format trivia questions (`2 ≤ min ≤ max ≤ 4`). Today it lives **only** at `config.trivia.choices` and resolves via `getActiveChoiceBounds(triviaConfig)` (`domain/questionTypes.ts`), which is a flat `triviaConfig?.choices ?? DEFAULT_TRIVIA_CHOICES`. Both the type comment (`configTypes.ts:94`) and resolver comment assert it is "workspace-only by design … never season-scoped."

Every other generation-affecting knob is a `CascadeAxes` member resolved through one generic path: `resolveCascade(key, ctx)` driven by `AXIS_REGISTRY` (`domain/resolveCascade.ts`). Adding a member is, by design, a 3-line touch (`CascadeAxes` field + `AXIS_REGISTRY` entry + `AXIS_KEYS` tuple); a compile-time mapped type and runtime parity tests then force the parser, `explain_cascade`, and `list_games` to stay in lockstep.

`choices` has exactly two consumers, both inside the choice answer-type handler (`answerTypes/choice.ts`), so the handler-owns-format-logic boundary is already respected:

1. **Roll** — `rollGenerationSuggestions(deps)` reads `getActiveChoiceBounds(deps.cascadeCtx.config)` and rolls `suggestedChoiceCount = randInclusive(min, max)` + `suggestedCorrectIndex`. It already holds the **full** `cascadeCtx` (with slot index).
2. **Save-validation** — `composeStatic(base, args, ctx)` validates `args.choices.length ∈ [min, max]` via `ctx.config?.choices`. Its `SaveValidationContext` carries only `config` + `resolvedJudgeLeniency`, **not** the full cascade context.

## Goals / Non-Goals

**Goals:**
- `choices` cascades `slot → season → game → workspace → default` (`{ min: 4, max: 4 }`), first-wins whole-object replace per tier, like every other flat axis.
- Per-slot pacing works: `game.format.questions[i].choices` overrides for slot `i`.
- Zero behavioral change for deployments that don't set `choices` below the workspace tier.
- One resolution path: `resolveCascade("choices", ctx)`. No bespoke resolver survives.

**Non-Goals:**
- No stamping on `TriviaQuestion` and no `find_previous_questions` surface — the stored `choices` array already encodes the resolved count; bounds have no reveal-time effect.
- No change to the `2 ≤ min ≤ max ≤ 4` constraint or the validator/zod (reused verbatim at every tier).
- No data migration; no new config defaults.

## Decisions

### 1. Model `choices` as a first-wins `CascadeAxes` member, not a custom resolver

`makeFirstWins("choices", DEFAULT_TRIVIA_CHOICES)` in `AXIS_REGISTRY`. The whole `{min,max}` object replaces per tier (no field-level merge across tiers), matching the documented cascade contract. This auto-lights `explain_cascade` and `list_games` (they iterate the registry) and satisfies the membership rule (it now resolves through slot/season).

_Alternative considered — game+workspace-only tier (like `allTimeRow`):_ rejected. The driving use case is **per-slot pacing**, which is impossible without the slot tier; a partial cascade would contradict the "full-cascading" intent and still need a bespoke resolver.

### 2. Save-validation reads a resolved value handed down on `SaveValidationContext` (mirror `resolvedJudgeLeniency`)

`composeStatic` lacks the full cascade context, but `save_question` already builds `buildCascadeContext(season, game, slotIndex, config)` to resolve `judgeLeniency` and hands the result down as `SaveValidationContext.resolvedJudgeLeniency`. Add `resolvedChoiceBounds: TriviaChoicesConfig` the same way: `save_question` resolves once via `resolveCascade("choices", ctx)`, and `composeStatic` reads `ctx.resolvedChoiceBounds` instead of `ctx.config?.choices`.

_Alternative considered — widen `SaveValidationContext` to carry the full `CascadeContext`:_ rejected as over-broad; the established precedent is to hand down only the resolved per-format value, keeping the handler's surface minimal and consistent with `judgeLeniency`.

### 3. Roll site swaps directly to `resolveCascade`

`rollGenerationSuggestions` already holds `deps.cascadeCtx`, so it changes from `getActiveChoiceBounds(deps.cascadeCtx.config)` to `resolveCascade("choices", deps.cascadeCtx).value`. This is the per-axis-resolver ban the `SuggestionRollDeps` doc-comment already anticipates ("Cascade-member axes MUST be resolved through `resolveCascade`").

### 4. Delete `getActiveChoiceBounds`

With both consumers on `resolveCascade`, the workspace-only resolver is dead. Removing it (rather than leaving it as a thin wrapper) keeps the "single resolution path" invariant the `cascadeSingleImplementation` guard test enforces.

### 5. Reuse the existing validator + zod at every tier

`validateTriviaChoicesConfig` / `choicesSchema` already exist and are wired at the workspace tier. The season/game/slot parse paths simply call the same validator. Per the cascade-registry parser-parity requirement, the parser's accepted axis-key union must equal `keyof CascadeAxes`, so the parity test fails until `choices` is parseable at the new tiers — a built-in completeness check.

## Risks / Trade-offs

- **[Reversing a documented "workspace-only by design" decision]** → The original rationale (card readability is workspace-uniform) is superseded by the orthogonal-lever use case. Mitigation: rewrite — not append to — the stale comments in `configTypes.ts` and `domain/questionTypes.ts`, and the `trivia-choice-questions` spec requirement, so no contradictory guidance remains.
- **[Inert overrides on non-choice tiers]** → A `choices` value set on a slot/season/game that never rolls `answersFormat: "choice"` is silently unused. This matches how every axis behaves when its format isn't rolled (e.g. `freeformAnswerShape` on a boolean-only game); acceptable, and visible via `explain_cascade`.
- **[Two consumers must agree]** → If roll and save-validation resolved different bounds, a valid roll could fail save. Mitigation: both call the identical `resolveCascade("choices", ctx)` against the same coordinate; the cross-tool parity test already asserts roll ≡ save for cascade members.

## Migration Plan

No data migration. Deploy is a pure code change; existing `config.json` files (workspace-tier `choices` or none) resolve byte-identically. Rollback is a straight revert — no persisted shape changes, so no forward/backward data concern.

## Open Questions

None.

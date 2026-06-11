## Why

Trivia's `choices: { min, max }` (the option-count bounds for choice questions) is the only generation-affecting knob that is **workspace-only** — every sibling axis (`answersFormat`, `difficulty`, `promptMedium`, …) cascades `slot → season → game → workspace → default`, but `choices` was deliberately frozen at the workspace tier as a "card-readability" setting. In practice it's an orthogonal difficulty/pacing lever: a per-slot batch may want a 2-option opener escalating to 4-option later slots, and a game or season may want its own spread. The workspace-only restriction blocks that with no real upside, and its absence is surprising given every other axis cascades.

## What Changes

- Promote `choices` to a full **first-wins cascade axis** (`slot → season → game → workspace → built-in default`), making it a `CascadeAxes` member resolved through the existing `AXIS_REGISTRY` / `resolveCascade` machinery (`makeFirstWins("choices", DEFAULT_TRIVIA_CHOICES)`).
- Accept `choices` at the season, game, and slot tiers (the workspace tier already accepts it). The existing validator (`validateTriviaChoicesConfig`) and zod schema are reused unchanged; the `2 ≤ min ≤ max ≤ 4` constraint holds at every tier.
- Resolve the active bounds at both consumers through the cascade instead of the workspace-only `getActiveChoiceBounds`:
  - the roll site (`choice.rollGenerationSuggestions`) already holds the full `cascadeCtx` → swap to `resolveCascade("choices", cascadeCtx)`;
  - the save-validation site (`choice.composeStatic`) receives a resolved value handed down on `SaveValidationContext`, mirroring how `resolvedJudgeLeniency` already works.
- Surface per-tier `choices` overrides in `upsert_game`, `upsert_season` (including its slot tier), and the `list_games` / `explain_cascade` audit surfaces (the registry lights the audit tools up automatically).
- Delete the now-redundant `getActiveChoiceBounds` resolver.
- **No stamping** — the stored `choices` array already encodes the resolved count, so no new `TriviaQuestion` field and no `find_previous_questions` change are needed.
- Behavior is unchanged for any deployment that does not set `choices` below the workspace tier — the default (`{ min: 4, max: 4 }`) and existing workspace-level configs resolve identically.

## Capabilities

### New Capabilities
<!-- none — this extends existing capabilities -->

### Modified Capabilities
- `trivia-cascade-registry`: `choices` becomes a `CascadeAxes` member (removed from the deliberately-excluded list, added to the membership roster); the parser-parity and registry-exhaustiveness requirements now include it.
- `trivia-choice-questions`: the choice-count bounds resolve through the full cascade rather than workspace-only; the "SHALL NOT be season/slot-overridable" requirement is reversed, and `get_ideas` / `save_question` read cascade-resolved bounds.

## Impact

- **Types** — `CascadeAxes` gains `choices?`; `SeasonFormatSlot`, `SeasonEntry`, `TriviaGame` gain the field (workspace `TriviaConfig` already has it).
- **Registry** — one `AXIS_REGISTRY` entry + one `AXIS_KEYS` tuple entry.
- **Parsers** — season / game / slot parse paths accept `choices` (validator + zod already exist).
- **Consumers** — `answerTypes/choice.ts` (roll + save), `answerTypes/types.ts` (`SaveValidationContext`), `tools/questions/saveQuestion.ts` (resolve-and-hand-down), `domain/questionTypes.ts` (delete `getActiveChoiceBounds`).
- **Write/read tools** — `upsert_game`, `upsert_season`, `list_games` (`set_workspace_config` already handles it).
- **Docs** — `CLAUDE.md` plus the "workspace-only by design" comments in `configTypes.ts` / `questionTypes.ts` are now wrong and must be rewritten.
- No data migration; no breaking change for existing configs.

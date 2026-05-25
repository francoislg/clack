## Why

Difficulty roll today is a hardcoded 30/60/10 split (`pickSuggestedDifficulty` in `getIdeas.ts:24-29`) glued to a `minimumThreshold` "reject below N" floor. There's no way for admins to skew a game easier or harder, and the threshold-vs-bucket-range split is two ways to express "what difficulty is acceptable" — confusing in config and unused in practice because the buckets already encode the target.

Replace both with a single cascading weighted axis (`difficultyRatio`) that mirrors how `answersFormat`, `questionType`, `freeformAnswerShape`, and `contexts` already work, and fold the floor into the bucket itself: the rolled bucket's range IS the accept/reject bound.

## What Changes

- **BREAKING** Remove `minimumThreshold` from `DifficultyRanges` (schema, validators, resolver, defaults, and the `minimumDifficultyThreshold` field on the `get_ideas` response).
- **BREAKING** Remove the hardcoded 30%/60%/10% Easy/Medium/Hard distribution; replace with weighted random over a configured ratio.
- Add new cascading axis `difficultyRatio: Record<"boolean"|"choice"|"freeform", Record<"easy"|"medium"|"hard", number>>` at workspace / game / season / slot tiers. Same shape, validation pattern, and cascade as `answersFormat`. Per-format keying (because freeform may want a softer skew than boolean/choice); whole-object replace per tier (no per-field merge).
- Per-format default ratio: boolean / choice default to `{ easy: 3, medium: 6, hard: 1 }` (preserving today's effective 30/60/10); freeform defaults to `{ easy: 5, medium: 4, hard: 1 }` so freeform games skew easier than the multiple-choice formats. This mirrors how `DEFAULT_DIFFICULTY_RANGES` already shifts freeform ranges down by 2 — typing an answer is intrinsically harder than picking from a list, so the default distribution leans easier too.
- Rewrite the DIFFICULTY GATE in `scheduledPrompts.ts` (both sites: fact-boolean and fact-choice flows) and `triviaCheckInstruction.ts`:
  - The bucket's `[min, max]` range is the strict accept bound (no separate threshold).
  - Self-rating inside range → save.
  - Self-rating exactly ±1 off → REFRAME ONCE (rewrite the question to dial difficulty up or down), re-rate; if v2 still outside, reject and re-roll `get_ideas`.
  - Self-rating ≥2 outside range → reject and re-roll `get_ideas` immediately.
  - After a reframe of a boolean question, re-run the polarity self-check (reframing a TRUE statement easier by swapping a detail can silently flip it FALSE).
- Update zod schemas in `setWorkspaceConfig`, `upsertGame`, and `upsertSeason` to add `difficultyRatio` and drop `minimumThreshold`.
- Update `get_ideas` response: drop `minimumDifficultyThreshold`; `suggestedDifficulty` is now picked via `weightedPick(resolveDifficultyRatio(...))`.
- **No data migration.** The `difficulty.*.minimumThreshold` field will be a parse error if encountered; the single deployment will be updated manually.

## Capabilities

### New Capabilities

None — this is a refinement of existing trivia behavior, not a new capability.

### Modified Capabilities

- `trivia-categories`: `get_ideas` server-rolled metadata — `suggestedDifficulty` picker changes from hardcoded 30/60/10 to weighted-pick from cascaded `difficultyRatio`; `minimumDifficultyThreshold` field removed from response.
- `trivia-scheduled-prompts`: DIFFICULTY GATE rewritten with strict-membership + one-shot reframe + ≥2-off reject.
- `trivia-games`: workspace `TriviaConfig` and per-game `TriviaGame` gain `difficultyRatio?`; `difficulty.*.minimumThreshold` removed from accepted shape.
- `trivia-seasons`: season-tier and slot-tier shapes gain `difficultyRatio?`; `difficulty.*.minimumThreshold` removed; `upsert_season` and `upsert_slot` zod schemas updated.
- `trivia-choice-questions`: difficulty gate description updated (no separate threshold; strict-membership + reframe).
- `trivia-topical-questions`: difficulty gate description updated (shares the gate with fact paths).

## Impact

- **Code:**
  - `src/plugins/trivia/core/configTypes.ts` — drop `minimumThreshold` from `DifficultyRanges`; add `TriviaDifficultyRatio*` types + `DEFAULT_DIFFICULTY_RATIO`.
  - `src/plugins/trivia/core/configParsers/axes.ts` — drop `minimumThreshold` from `validateDifficultyRangesMap`; add `validateDifficultyRatioMap` + `validateTriviaDifficultyRatioMap`; wire into `parseTriviaAxisBag`.
  - `src/plugins/trivia/domain/difficulty.ts` — drop `minimumThreshold` from `resolveDifficultyRanges`; add `resolveDifficultyRatio` (whole-object replace, mirror of `resolveQuestionType`).
  - `src/plugins/trivia/tools/questions/getIdeas.ts` — delete `pickSuggestedDifficulty`; replace with `weightedPick(resolveDifficultyRatio(...))`; drop `minimumDifficultyThreshold` from response payload; update DESCRIPTION docstring.
  - `src/plugins/trivia/tools/games/setWorkspaceConfig.ts` — drop `minimumThreshold` from zod schema (3 sites: boolean/choice/freeform); add `difficultyRatio` zod schema field.
  - `src/plugins/trivia/tools/games/upsertGame.ts` — same as above.
  - `src/plugins/trivia/tools/seasons/upsertSeason.ts` — drop `minimumThreshold` from season + slot zod schemas; add `difficultyRatio` to season and slot.
  - `src/plugins/trivia/prompts/scheduledPrompts.ts` — rewrite DIFFICULTY GATE step in both `QUESTION_FLOW_STEPS` (fact-boolean) and `CHOICE_FLOW_STEPS` (fact-choice); update the topical flows that share the gate.
  - `src/plugins/trivia/prompts/triviaCheckInstruction.ts` — update the `difficulty` axis description.
  - `src/plugins/trivia/core/types.ts` — `SeasonEntry` and `FormatQuestion` (slot) gain `difficultyRatio?`.
- **Tests:** `difficulty.test.ts`, `getIdeas.test.ts`, `trivia.test.ts`, `seasons.test.ts`, `setWorkspaceConfig.test.ts`, `upsertGame.test.ts`, `upsertSeason.test.ts` — update existing assertions; add coverage for ratio resolution + the reframe path.
- **APIs / external surfaces:** none — internal MCP tool schemas only.
- **Data / migration:** none. Existing on-disk `data/plugins/trivia/config.json` with `minimumThreshold` will fail validation; the single live deployment will be updated manually before deploy.

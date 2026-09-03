## 1. Make the tier list a single source (pre-work)

- [x] 1.1 Derive `difficulty.ts`'s `tiersBroadestFirst` from `CASCADE_TIER_ORDER` instead of the hand-written array at `domain/difficulty.ts:16`; keep the reverse-order walk for `resolveDifficultyRatio`
- [x] 1.2 Add a guard test asserting the broadest-first walk is exactly `[...CASCADE_TIER_ORDER].reverse()`, so a future tier cannot be silently skipped by the custom resolvers
- [x] 1.3 Confirm the existing `difficulty` / `difficultyRatio` / `resolveCascade` suites pass unchanged (behavior-preserving refactor — same tiers, same order)

## 2. Types and the phase tier

- [x] 2.1 Add `PhaseSlice` to `core/types.ts`: `extends CascadeAxes` plus `{ slug: string; days?: number; theme?: string; categories?: string[] }`, with a doc comment stating it is the temporal twin of `SeasonFormatSlot` and why `format` / `slotOverrides` / scoring fields are excluded
- [x] 2.2 Add `SeasonEntry.phases?: PhaseSlice[]` with a doc comment covering duration chaining and the open-ended final slice
- [x] 2.3 Add `TriviaQuestion.phase?: string` with a doc comment stating absence means "no phase tier" and that reveal reads this stamp rather than the clock
- [x] 2.4 Add `"seasonPhase"` to `ConcreteTier`, to the separate `CascadeTier` union, and to `CASCADE_TIER_ORDER` between `seasonSlot` and `season`; add `seasonPhase: PhaseSlice | null` to `CascadeContext`
- [x] 2.5 Update the `cascadeAxes.ts` file header and the `ConcreteTier` doc comment ("five concrete tiers" → six): tier count, the new tier's placement and rationale, and `PhaseSlice` in the list of types extending `CascadeAxes`

## 3. Phase selection

- [x] 3.1 Create `domain/seasonPhases.ts` with a pure `derivePhaseWindows(season)` returning each slice's computed `[start, end)` — chaining from `season.startedAt`, final slice ending at `endedAt ?? expectedEndAt`
- [x] 3.2 Add `selectActivePhase(season, now)` returning the slice whose half-open window contains `now`, or `null` when there are no phases or `now` is outside the season window
- [x] 3.3 Unit-test chaining, half-open boundaries, the open-ended final slice absorbing a moved `expectedEndAt`, a season shortened below its declared durations (later phases truncated / never reached), and the `null` cases
- [x] 3.4 Populate `ctx.seasonPhase` in `buildCascadeContext` via the selector; take `now` as an explicit parameter rather than reading the clock inside, so callers control the moment
- [x] 3.5 Extend `cascadeContext.test.ts` for the new tier, including that a phaseless season and an absent season both yield `seasonPhase: null`

## 4. Cascade resolution

- [x] 4.1 Add `seasonPhase` to `tierObjects()` in `domain/resolveCascade.ts` (compile error until done)
- [x] 4.2 Add the `seasonPhase` entry to `ADDITIONAL_INSTRUCTIONS_LABEL` with the `[Phase]` label (compile error until done)
- [x] 4.3 Test first-wins precedence: phase beats season; `seasonSlot` pins against the phase; phase loses to `seasonSlot`
- [x] 4.4 Test `difficulty` per-field merge across the phase tier, and `difficultyRatio` first-wins through it
- [x] 4.5 Test `additionalInstructions` emits a `[Phase]` segment in broadest-first order and reports `tier: "merged"`
- [x] 4.6 Add a regression test asserting a season with no `phases` resolves every axis to the identical value and tier as before this change

## 5. Validation and persistence

- [x] 5.1 Add a `phases` zod schema in `core/configParsers/` reusing **`seasonFormatSlotZod`** (`configParsers/format.ts:340` — the full 16-axis per-tier bag, NOT `axes.ts`'s 7-field `axisFieldsZod`), plus `slug` (kebab-case via `validateSeasonSlug`, unique within the array), `days` (positive integer), `theme` (non-empty trimmed), `categories` (non-empty, deduped preserving first-occurrence order)
- [x] 5.2 Enforce the chaining rules: at least one slice; every non-final slice declares `days`; the final slice omits it
- [x] 5.3 Reject `format`, `slotOverrides`, and the scoring fields (`teams`, `teamsEnabled`, `teamsFinaleIndividuals`, `teamsScoring`, `answeringType`, `perfectRoundsAward`, `allTimeRow`) on a slice in the strict path; drop them field-by-field with a logged issue in the lenient path
- [x] 5.4 Build a permissive `SeasonsState` / `SeasonEntry` zod schema (modelled on the `ParseIssue` pattern in `configParsers/games.ts`) and route `loadSeasonsState` (`core/dataLayer.ts:187`) through it — today it is a bare `JSON.parse` cast with no validation. Keep it permissive: no `.strict()`, model legacy/optional fields, drop the offending field and log rather than discarding a season
- [x] 5.5 Make an invariant-violating `phases` array (duplicate slug, non-final slice missing `days`, final slice declaring `days`) drop the array **whole** for that season — a partially-applied chain would shift every later slice's window
- [x] 5.6 Test that a pre-phase `seasons.json` parses with no `phases` and no logged issue, and that a valid multi-season file round-trips
- [x] 5.7 Test the rejection paths: duplicate slug, non-final slice missing `days`, final slice declaring `days`, `days` of 0/negative/fractional, blank `theme`, empty `categories`, and structural/scoring fields — rejected in the strict path, dropped-with-logged-issue in the lenient path
- [x] 5.8 Test graceful degradation: a malformed `phases` drops only that field, an invariant-violating `phases` drops whole, and neither affects sibling seasons in the same file

## 6. Stamping and reveal

- [x] 6.1 Stamp `phase` in `tools/questions/saveQuestion.ts` from the resolved `ctx.seasonPhase`, writing the key only when a phase is active (absence is meaningful)
- [x] 6.2 In `tools/reveal/computeAnswers.ts`, bind the **cascade context's** season via `findSeasonBySlug(state, question.season)` instead of the `now`-derived `currentSeasonForResolution` (`:281`), falling back to today's season when the question carries no season stamp. Scope this to the cascade context at `:348` and `:589` only — leave `resolveTeamsConfig`, finale detection, and `resolvePerfectRoundsAward` on the existing reveal-time season
- [x] 6.3 Resolve the batch's phase tier from the **first reveal target's** stamped `phase` slug (matching the existing `firstSlotIndex` convention for the once-per-batch `instructions` / `additionalInstructions`), never re-selecting from `now`
- [x] 6.4 Resolve an unmatched stamped slug (renamed/removed phase) to no phase tier, with no error and no substitution
- [x] 6.5 Test the boundary case end to end: a question stamped under one phase whose reveal fires after the next phase has begun resolves `instructions` / `additionalInstructions` through the stamped phase
- [x] 6.6 Test the cross-season case: a question stamped `season: "autumn"` revealed while a different season is active resolves its phase from `autumn`'s slices
- [x] 6.7 Test that a phaseless season writes no `phase` key, and that a mixed-stamp batch anchors on the first target

## 7. Structural resolvers (theme, categories)

- [x] 7.1 Migrate `resolveActiveCategoriesWithSource` **and its `resolveActiveCategories` wrapper** from five positional args to a `CascadeContext`, updating every call site (`get_ideas` — including the per-slot `formatMeta` loop at `getIdeas.ts:190` — `save_question`, `list_seasons`)
- [x] 7.2 Add the phase rung to the category cascade (`slot → phase → season → game → global`) and add `"phase"` to `CategorySource`
- [x] 7.3 Add the phase rung to `resolveTheme` (`phase → season → game → null`), taking a `CascadeContext` for consistency
- [x] 7.4 Test both cascades: phase wins over season, slot still wins over phase, and phaseless resolution is unchanged

## 8. Admin tools

- [x] 8.1 Add the `phases` argument to `tools/seasons/upsertSeason.ts` with omit-to-keep / null-to-clear semantics, validated against the section-5 schema
- [x] 8.2 Add `upsertSeason.phases.test.ts` (matching the per-axis precedent of `upsertSeason.theme.test.ts` / `.slotOverrides.test.ts`) covering wholesale replace, omit-to-keep, null-to-clear, and reject-on-invalid
- [x] 8.3 Surface the derived timeline in `tools/seasons/listSeasons.ts` — per-slice slug, computed start/end, and which slice is active; phaseless seasons render with no phase keys
- [x] 8.4 Test `list_seasons` renders computed windows, marks the active slice, and leaves phaseless seasons unchanged
- [x] 8.5 Report the active phase slug in `tools/games/explainCascade.ts`, and test that axes won by the phase report `tier: "seasonPhase"` in the ladder
- [x] 8.6 Surface the `phase` stamp in `find_previous_questions` when the record carries one, and test both the present and absent cases
- [x] 8.7 Update `TRIVIA_GAMES_ADMIN_INSTRUCTION`'s season-management section in `prompts/triviaCheckInstruction.ts` (and `TRIVIA_MANAGEMENT_INSTRUCTION` where it duplicates that guidance) so Claude knows phases exist, that they are season-scoped, and that edits affect only future questions

## 9. Verification

- [x] 9.1 Extend `configParsers/cascadeParity.test.ts` and `tools/cascadeParity.crossTool.test.ts` to cover a coordinate with an active phase
- [x] 9.2 Add an integration test for the escalating-season scenario: three chained phases, a slot pinning `difficultyRatio`, and questions generated at three points in time resolving through the right phase
- [x] 9.3 Run `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, and the full `npm test` suite
- [x] 9.4 Update `CLAUDE.md`'s trivia cascade section: the 7-tier walk (six concrete tiers plus the built-in default) including `seasonPhase`, and the two deferred follow-ups (`seasonPhaseSlot` unlocking `phase.format` / `phase.slotOverrides`; `gamePhase` with cycling anchors)
- [x] 9.5 Run `openspec validate add-trivia-season-phases --strict`

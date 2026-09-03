## Why

A trivia season is currently uniform: every question from day 1 to day 60 resolves the same cascade. There is no way to say "the first two weeks are gentle, the last week is a gauntlet" — escalation, themed weeks, or any rule that varies *over the course of* a season must be hand-edited mid-season and hand-reverted afterwards.

The cascade already varies rules by POSITION (`seasonSlot` / `gameSlot` — slot 3 of every round). What it cannot do is vary rules by TIME. Season phases add that missing dimension using the machinery that already exists.

## What Changes

- **New cascade tier `seasonPhase`**, sitting directly below `seasonSlot` and above `season`. It joins `CASCADE_TIER_ORDER`, so all 16 `CascadeAxes` members resolve through it for free via the generic walker.
- **New `PhaseSlice` type** — structurally a temporal twin of `SeasonFormatSlot`: `extends CascadeAxes` plus `{ slug, days?, theme?, categories? }`. A format slot is a positional axis bag; a phase slice is a temporal one.
- **`SeasonEntry.phases?: PhaseSlice[]`** — an ordered list, **duration-chained** rather than date-ranged. Each slice runs `days` days from where the previous ended, anchored at `season.startedAt`; the final slice omits `days` and runs open-ended to the season's end. Overlap is impossible by construction, so no interval validation is needed, and extending a season is absorbed by the open-ended tail.
- **Phase selection** is a pure function `(season, now) → PhaseSlice | null`, evaluated in `buildCascadeContext` and populating the new context tier.
- **Phase slug is STAMPED** on `TriviaQuestion` as `phase?: string`, parallel to the existing `season` stamp. `process_reveal_answers` resolves the phase tier from the STAMP, never from `now`, so a phase boundary falling between post and reveal cannot flip `instructions` mid-round. A renamed or deleted phase degrades to no phase tier (graceful reader), never to corrupt history.
- **`process_reveal_answers` binds its cascade-context season from the question's stamp too.** It currently derives that season with `findCurrentSeason(state, now)`; looking a stamped phase up on a `now`-derived season would reintroduce the same bug one tier higher after a season rollover. The context's season becomes `findSeasonBySlug(state, question.season)`, falling back to today's season when the question carries no season stamp. **Scoped to the cascade context only** — teams, finale detection, and perfect-rounds resolution keep the existing reveal-time season, since changing those would alter scoring. The once-per-batch `instructions` / `additionalInstructions` resolution anchors on the first reveal target's stamp, reusing the existing `firstSlotIndex` convention.
- **`theme` and `categories` gain a phase rung** in their own (non-registry) resolvers: `seasonPhase.theme → season.theme → game.theme` and `phase.categories` above `season.categories` in the category cascade. `CategorySource` gains a `"phase"` member.
- **`categories` resolver migrates from positional args to `CascadeContext`** so the phase tier does not become a sixth positional parameter threaded through every call site.
- **`difficulty.ts`'s hand-written `tiersBroadestFirst` array is derived from `CASCADE_TIER_ORDER`** instead of duplicating it — today it is the one tier list the compiler does not guard, and adding a tier would silently skip it.
- **`upsert_season` accepts `phases`** (omit-to-keep, null-to-clear); **`list_seasons` and `explain_cascade` surface the DERIVED windows** (`gauntlet: Nov 12 – Nov 30, active`), since chained durations mean boundary dates are computed and never stored.
- **Explicitly out of scope**: `phase.format` and `phase.slotOverrides` (both require a phase-slot tier that this change does not add — a phase format would change the question count while its per-slot axes went unread), and every scoring-identity field (`teams*`, `answeringType`, `perfectRoundsAward`, `allTimeRow`). A phase changes what questions are *like*; it never changes what a round *is* or how it is *scored*.
- **Not breaking.** A season with no `phases` key resolves byte-identically to today.

## Capabilities

### New Capabilities
- `trivia-season-phases`: the phase tier itself — `PhaseSlice` schema, duration-chained selection, tier placement below `seasonSlot`, the question-record stamp and reveal-reads-the-stamp rule, and the scope boundary that keeps structural and scoring fields out.

### Modified Capabilities
- `trivia-cascade-registry`: `ConcreteTier` and `CASCADE_TIER_ORDER` gain `seasonPhase`; `CascadeContext` gains the tier object; `explain_cascade`'s ladder reports it; the tier order becomes the single source for `difficulty.ts`'s broadest-first walk.
- `trivia-seasons`: `seasons.json` has **no validation at all** today (`loadSeasonsState` is a bare `JSON.parse` cast, and no `SeasonEntry` schema exists in the plugin), so this change introduces the first permissive reader for it — `phases` is one of the fields it validates, not a field added to an existing schema. `upsert_season` writes `phases`; `list_seasons` surfaces the computed timeline.
- `trivia-games`: the `theme` and `categories` cascades gain a phase rung above their season tier; the categories resolver takes a `CascadeContext`.
- `trivia-question-search`: `find_previous_questions` surfaces the `phase` stamp alongside the existing `season` / `slot` provenance.

## Impact

**Code**
- `src/plugins/trivia/core/cascadeAxes.ts` — `ConcreteTier`, `CASCADE_TIER_ORDER`, `CascadeContext`
- `src/plugins/trivia/core/types.ts` — `SeasonEntry.phases`, `PhaseSlice`, `TriviaQuestion.phase`
- `src/plugins/trivia/domain/cascadeContext.ts` — phase selection and tier population
- `src/plugins/trivia/domain/resolveCascade.ts` — `tierObjects`, `ADDITIONAL_INSTRUCTIONS_LABEL`
- `src/plugins/trivia/domain/difficulty.ts` — derive the broadest-first list from `CASCADE_TIER_ORDER`
- `src/plugins/trivia/domain/categories.ts`, `theme.ts` — phase rung
- New: `src/plugins/trivia/domain/seasonPhases.ts` — phase selection (duration chaining + derived windows)
- `src/plugins/trivia/core/configParsers/` — phase validation, reusing `seasonFormatSlotZod` (the existing full 16-axis per-tier bag)
- `src/plugins/trivia/core/dataLayer.ts` — `loadSeasonsState` routed through the new permissive `SeasonsState` schema
- `tools/questions/saveQuestion.ts` (stamp), `tools/reveal/computeAnswers.ts` (read stamp + rebind the cascade season), `tools/games/explainCascade.ts`, `tools/seasons/*` (`upsert_season`, `list_seasons`), `tools/questions/findPreviousQuestions.ts`

**Data**
- `data/plugins/trivia/games/*/seasons.json` — optional `phases` array; absent on every existing season
- `data/plugins/trivia/games/*/questions.json` — optional `phase` stamp; absent on every existing record

**No migration required.** Both new fields are optional and absence is meaningful (no phase tier), consistent with the graceful-reader philosophy for persisted state.

**Deferred, additive later**: a `seasonPhaseSlot` tier unlocking `phase.format` and `phase.slotOverrides` (per-slot escalation curves); a `gamePhase` tier with cycling anchors (`monthly` / `weekly`) for time-varying rules on seasonless games.

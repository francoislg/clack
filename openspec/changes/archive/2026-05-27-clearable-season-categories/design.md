## Context

The trivia plugin already has a three-tier category cascade defined in `src/plugins/trivia/domain/categories.ts:15` — `slot.categories → season.categories → game.categories → globalCategories`. The resolver explicitly tolerates `season.categories === undefined` (line 26 checks `!== undefined && length > 0`) and `game.categories === undefined` (line 29 falls through).

The cascade is incompletely supported by the write path:

- `upsert_season` CREATE always materializes a concrete `categories: string[]` — either the provided list (themed) or a snapshot copy of the global `categories.json` (non-themed). See `src/plugins/trivia/tools/seasons/upsertSeason.ts:204-216`.
- `upsert_season` UPDATE explicitly preserves `existing.categories` and the description says `categories is ignored on UPDATE`. There is no `null`-clears branch like every other axis has.
- `remove_categories` rejects removals that would empty a season's `categories` array (`src/plugins/trivia/tools/categories/removeCategories.ts:86-95, 132-148`).
- The lazy seasons-state seeder copies `categories.json` into the starter season's `categories` (see `trivia-seasons` Requirement: lazy seeding).
- `SeasonEntry.categories` is a required `string[]` on the type and on the loader.

Net effect: a season can never inherit its category pool from its game or from the global baseline. Admins who want "this season uses whatever the game uses" have no path — the snapshot is permanently divergent from `categories.json` and from any future game-level pool.

The user-facing motivation is concrete: "I want to update the current season so it falls back on the game's categories", and "by default, when creating a new season, it should have `categories: undefined` so it falls back on the game".

## Goals / Non-Goals

**Goals:**

- Make `season.categories` optional on the type, the disk schema, and the parser.
- CREATE in `upsert_season`: omit-by-default. Only write `categories` when the caller passes a non-empty explicit list.
- UPDATE in `upsert_season`: allow `null` to clear `categories`. Omitting still preserves.
- `remove_categories`: when a remove would bring the targeted season's pool to `0`, drop the `categories` field instead of erroring. The cascade then resolves.
- Lazy season seeder: omit `categories` on the starter entry.
- All downstream readers (`get_ideas`, `save_question`, slot-pool resolution, `list_seasons`) route through `resolveActiveCategories` in `domain/categories.ts` — the single source of truth for the cascade.
- Update specs and tool descriptions to match.

**Non-Goals:**

- No new MCP tools.
- No change to the `categories` cascade order itself.
- No automatic mass-rewrite of existing seasons. The opt-in migration `022-omit-seeded-season-categories` (gated by `trivia.seasons.migrateNonThemed`) is offered for admins who want to retroactively normalize "non-themed snapshots" — but it is **off by default** to honor "the snapshot was an intentional choice" for admins who treat the existing arrays as authoritative.
- No change to per-slot `categories` semantics (still always explicit in `format.questions[i].categories` when narrowing).
- No expansion of `add_categories` semantics. The tool gains one defensive error path: when its target season has no `categories` field, it returns a structured "this season inherits from {tier}; clear inheritance via upsert_season(categories: [...]) before adding" error rather than silently materializing the field. We are not deciding *how* materialization should work (copy the cascade-resolved pool first? write the single new entry as a list of one?) — that's a separate UX question and out of scope here.

## Decisions

### Decision 1: Optional field on type, parser, disk schema

`SeasonEntry.categories?: string[]` everywhere. The on-disk JSON for new seasons omits the key when unset. The parser accepts both shapes (present or absent). No version bump needed — JSON readers tolerating an absent key is forward/backward compatible.

**Alternative considered**: keep `categories: string[]` mandatory but allow `[]` to mean "inherit". Rejected — the resolver already treats `length > 0` as the gate, but `[]` on disk is ambiguous (did the admin clear it intentionally, or is it a corrupted write?). Omission is unambiguous; empty array stays disallowed.

### Decision 2: CREATE default = omit

`upsert_season` CREATE branch: if `args.categories` is undefined OR `args.categories.length === 0`, write the entry **without** the `categories` field. Drop the existing "copy from `categories.json`" block (`upsertSeason.ts:209-211`) and the zero-categories guard becomes "if `args.categories` was provided AND its normalized form is empty, error" — the omitted case is no longer an error path.

**Alternative considered**: keep "snapshot copy" as the create-default and offer a separate "create-inheriting" parameter. Rejected — it doubles the surface and conflicts with the cascade intent. The cascade is the default behavior of every other axis on `SeasonEntry`; categories should not be the lone exception.

**User-impact note**: this is a behavior change for non-themed creates. Admins who relied on the snapshot to freeze the current global pool at season-create time must now pass `categories: <list>` explicitly. The CREATE return shape gains `inheritsCategories: boolean` so the response surface explicitly signals what was written.

### Decision 3: UPDATE accepts `null` to clear

Mirror the existing convention used by `theme`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`, `format`, `liveAnswersVisible`, `revealResponses`, `instructions`, `additionalInstructions`. Schema: `triviaCategoriesZod.nullable().optional()`. Update branch reads:

```ts
let updatedCategories: string[] | undefined = existing.categories;
if (args.categories === null) {
  updatedCategories = undefined;
} else if (args.categories !== undefined) {
  const normalized = normalizeCategories(args.categories);
  if (!normalized.ok) return errorResult(normalized.error);
  if (normalized.value.length === 0) return errorResult("Empty `categories` array on update — pass null to clear or pass a non-empty list to replace.");
  updatedCategories = normalized.value;
}
```

The zero-categories guard at `upsertSeason.ts:514` is **removed**: a cleared `categories` is the explicit "inherit from game/global" signal, not an error.

Tool description updates: remove the "Used only on CREATE" sentence; add "Pass `null` to clear and fall through to the game/global cascade."

### Decision 4: `remove_categories` empties to undefined, not error

In `removeCategories.ts`:

- The current-season branch (`target: "current"` or `"both"`): if `next.length === 0`, replace the season entry without `categories` (use a helper `omitSeasonCategories(state, slug)`) instead of returning the active-pool-empty error.
- The specific-slug branch (`target: <slug>`): same — if `next.length === 0`, drop the field.
- The `default` (`categories.json`) branch keeps its existing guard — emptying the global baseline IS still rejected because every cascade tier above it can fall through to here, and emptying it would leave seasons-without-categories with literally nothing.
- Response shape gains an explicit `cleared: { current?: true, <slug>?: true }` marker so Claude sees the field was dropped (vs. just totals going to zero with categories still present).

Helper (in `removeCategories.ts`):

```ts
function omitSeasonCategories(state: SeasonsState, slug: string): SeasonsState {
  return {
    seasons: state.seasons.map((s) => {
      if (s.slug !== slug) return s;
      const { categories: _, ...rest } = s;
      return rest;
    }),
  };
}
```

### Decision 5: Lazy seeder omits categories

The lazy seasons-state seeder (see `trivia-seasons` spec Requirement: lazy seeding) currently copies `categories.json` into the starter season. Change: write the starter without a `categories` field. The resolver will fall through to `game.categories` (if set) or `categories.json` (always present per the categories spec).

### Decision 6: Reader funnel — `resolveActiveCategories` is the only entry point

Every read of a season's category pool MUST go through `resolveActiveCategories(effectiveFormat, slotIndex, currentSeason, game, globalCategories)` in `src/plugins/trivia/domain/categories.ts`. Audit and route:

- `get_ideas` slot-pool path: route through resolver; pass the slot index when format is present.
- `save_question`: route through resolver; the "category not in pool" error message updates to surface which tier the pool resolved from ("this season inherits from {game|global}; the category is missing from that pool").
- `list_seasons`: shows the raw stored `categories` field when present, and `null` (or omits the field) when absent — surfacing the inheritance state to admins. Add a derived `resolvedCategoriesCount: number` on each entry's row so admins can see what the cascade currently yields.
- The format-slot resolver in `domain/format.ts` (or wherever slot effective-categories live) already calls into the categories resolver — verify with a grep.

### Decision 7: Optional migration 022 (off by default)

`src/migrations/022-omit-seeded-season-categories.ts` (blocking, idempotent):

- Gated by `config.trivia.seasons.migrateNonThemed === true`. Default `false`. No-op when absent.
- For each game's `seasons.json`, for each entry, if `entry.categories` is byte-equal to the global `categories.json` AT THE TIME OF MIGRATION RUN (sort-then-compare to tolerate write-order drift), rewrite the entry without `categories`.
- Bumps migration version. Safe to re-run.

Admins who want the new behavior retroactively flip the flag and restart. Admins who treat their existing arrays as intentional pools leave the flag off and lose nothing.

## Risks / Trade-offs

- **[Risk]** Admins who currently use `upsert_season(... no categories arg)` expecting the global snapshot will now get inheritance. → **Mitigation**: the CREATE response shape carries `inheritsCategories: boolean` and the trivia management instruction surfaces the new default explicitly. The tool description states the new default in bold.
- **[Risk]** `add_categories(target: "<slug>")` on a season with no `categories` field needs a defined behavior. Current draft returns an error nudging admins to use `upsert_season(categories: [...])` first. → **Mitigation**: ship the error path now; if it proves annoying in practice, follow up with an `add_categories` change that materializes from the cascade. Keeps this change scoped.
- **[Risk]** `save_question` error message change ("inherits from {tier}") could confuse Claude if it doesn't know what "tier" means in context. → **Mitigation**: keep the error structured (`code: "CATEGORY_NOT_IN_POOL"`, `pool: { source: "season" | "game" | "global", categories: [...] }`) so Claude has the data without needing prose interpretation.
- **[Risk]** Spec churn across two existing capabilities (`trivia-seasons` and `trivia-categories`) — deltas must stay consistent. → **Mitigation**: spec deltas are written together; a `review-spec-coherence` pass at PR time catches drift.
- **[Trade-off]** We don't auto-migrate existing seasons. Admins with non-themed seasons created pre-change keep their static snapshots until they explicitly opt in or delete+recreate. This is the conservative choice; preserves admin-intent at the cost of two distinct mental models post-rollout.
- **[Trade-off]** The empty-clears-via-`remove_categories` path mutates structure (drops a field), not just content. Tools that pretty-print diffs of seasons.json will show a key disappearing — a one-time surprise but desirable behavior.

## Migration Plan

1. Land the type change + parser change. Existing data continues to work (categories-present is still valid).
2. Land `upsert_season` UPDATE-null-clears behavior. (No data shape change yet for any caller.)
3. Land `remove_categories` empties-clears-field behavior. (Data shape change only on the affected season.)
4. Land lazy-seeder omits-categories behavior. (Only affects newly-seeded starter seasons.)
5. Land `upsert_season` CREATE omits-by-default behavior. (Behavior change for existing tool callers — this is the most user-visible change.)
6. Reader audit: ensure every read funnels through `resolveActiveCategories`. Fix any direct `season.categories` access that doesn't.
7. Optional migration 022 lands behind `trivia.seasons.migrateNonThemed` flag. Default off.
8. Update specs (`trivia-seasons`, `trivia-categories`) with deltas. Update tool descriptions. Update the trivia management instruction block.
9. **Rollback**: revert in order. Migration 022 has no rollback because removing a field is destructive — admins who run it should snapshot `seasons.json` first. (Document this in the migration's header comment.)

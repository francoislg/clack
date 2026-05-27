## 1. Type & schema changes

- [x] 1.1 Make `SeasonEntry.categories` optional (`string[] | undefined`) in `src/plugins/trivia/core/types.ts`.
- [x] 1.2 Update the seasons-state loader/parser in `src/plugins/trivia/core/configParsers/format.ts` (and wherever else parses raw `seasons.json` JSON) to accept absent `categories`. Keep the "non-empty when present" invariant — empty arrays on disk still rejected. (Parser is `JSON.parse` in `dataLayer.ts:139` — no schema validation; the optional type from 1.1 covers both shapes. Write-side `upsertSeason`/`removeCategories` enforce the non-empty-when-present invariant.)
- [x] 1.3 Update every `SeasonEntry.categories` consumer to compile cleanly under the optional shape. Concrete call sites to touch: `tools/seasons/listSeasons.ts`, `tools/questions/saveQuestion.ts` (or equivalent), `tools/categories/{add,remove}Categories.ts`, `tools/seasons/upsertSeason.ts` (already in scope below), `core/seedCategories.ts`, the format-slot pool path in `domain/format.ts`, and `get_ideas`'s pool resolution in `tools/questions/getIdeas.ts` (or equivalent). For each: route through `resolveActiveCategories` (preferred) or use an explicit `season.categories ?? <fallback>` only when the resolver is genuinely the wrong fit. The TypeScript error list after task 1.1 is the authoritative checklist — fix every error, no skips.
- [ ] 1.4 Add a unit test under `src/plugins/trivia/core/configParsers/` (or the existing seasons-state parser test file) that round-trips a season with no `categories` field through write → read → write and confirms the key stays omitted.

## 2. upsert_season — UPDATE accepts null to clear

- [x] 2.1 In `src/plugins/trivia/tools/seasons/upsertSeason.ts`, change the `categories` arg schema to `triviaCategoriesZod.nullable().optional()` and update the description (remove "Used only on CREATE"; document `null`-clears semantics and the new omit-to-keep behavior).
- [x] 2.2 In the UPDATE branch, replace the hard-copy `categories: existing.categories` with the standard "null clears / undefined keeps / non-empty replaces / empty rejects" pattern (mirror how `theme` is handled).
- [x] 2.3 Remove the zero-categories guard at the end of the UPDATE branch (currently `if (updated.categories.length === 0) ...`). Replace it with a "non-empty when present" check only when `updated.categories !== undefined`.
- [x] 2.4 Extend the return shape: add `hasCategories: boolean` and `inheritsCategories: boolean`; keep `categoriesCount` (0 when absent).
- [x] 2.5 Tests added in `seasons.test.ts`: UPDATE-null-clears, UPDATE-omit-preserves, UPDATE-empty-array-rejected.

## 3. upsert_season — CREATE default = omit

- [x] 3.1 In the CREATE branch of `upsertSeason.ts`, remove the "copy from `categories.json`" fallback (`categories = [...(await data.loadCategories())];`). When `args.categories` is undefined or `[]`, write the entry WITHOUT a `categories` field.
- [x] 3.2 Reject `args.categories === null` on CREATE with a structured "use omit instead of null to inherit on create" error.
- [x] 3.3 Remove the "Cannot create a season with zero categories" guard. The "inherits" case is now valid; only the "non-empty array provided but normalizes to empty after dedupe" path is an error.
- [x] 3.4 Update the entry-write so the `categories` key is conditionally spread (mirrors how `theme` is conditionally spread today).
- [x] 3.5 Update the CREATE return shape: include `hasCategories`, `inheritsCategories`, `categoriesCount: 0` when omitted.
- [x] 3.6 Tests added in `seasons.test.ts`: CREATE-no-categories writes no field, CREATE-empty-array writes no field, CREATE-with-non-empty writes list, CREATE-null rejected.

## 4. remove_categories — empties to undefined

- [x] 4.1 In `src/plugins/trivia/tools/categories/removeCategories.ts`, add an `omitSeasonCategories(state, slug)` helper that returns a new state with the named season's `categories` key removed.
- [x] 4.2 In the slug-targeted branch, replace the `next.length === 0` rejection with a call to `omitSeasonCategories(...)`. Save the resulting state. Add `cleared: { [slug]: true }` to the response.
- [x] 4.3 In the current-season branch (target `"current"` or `"both"`), do the same: empty-after-removal drops the field and is reflected in `cleared.current: true` in the response.
- [x] 4.4 Keep the `default` (global `categories.json`) guard — emptying the floor is still rejected. (Update the error message to clarify it's the cascade floor.)
- [x] 4.5 Update `removeCategories.ts` tool description to reflect the new behavior (no more "active pool empty" rejection for season targets; only the global floor is protected).
- [x] 4.6 Tests added in `seasons.test.ts`: empty current → field cleared, empty slug → field cleared, empty global → rejected.

## 5. Lazy seeder — omit categories

- [x] 5.1 Locate the lazy seasons-state bootstrap (search for the `season-YYYY-MM` slug pattern or the call site that writes the starter entry) and remove the `categories: [...await data.loadCategories()]` line. The starter entry is written without a `categories` field. (Lives in `src/plugins/trivia/core/dataLayer.ts` lazy `loadSeasonsState`.)
- [x] 5.2 Verify the starter entry still satisfies all other invariants (slug, startedAt, expectedEndAt). (Reviewed — kept `slug`, `startedAt`, `expectedEndAt`; dropped only `categories`.)
- [ ] 5.3 Add or update a test in the appropriate seasons bootstrap test file (likely `seasons.test.ts` under `tools/seasons/` or `core/`) covering: lazy seed writes no `categories` field; subsequent `get_ideas` call falls through to the game or global pool.

## 6. Reader funnel — `resolveActiveCategories` everywhere

- [x] 6.1 Route every read path that touches `season.categories` through `resolveActiveCategories(effectiveFormat, slotIndex, currentSeason, game, globalCategories)` in `src/plugins/trivia/domain/categories.ts`. (Touched: getIdeas, saveQuestion, listSeasons. Direct `.categories` reads that remain are all on local args / TriviaGame — verified.)
- [x] 6.2 In `get_ideas`'s tool implementation: replace direct `currentSeason.categories` reads with a call through the resolver passing the resolved game record and global pool. Wire the resolver's returned tier into the response's `categories.source` field. (Added `resolveActiveCategoriesWithSource` in `domain/categories.ts` returning `{ pool, source }`; `getIdeas` reads via that and surfaces `categories.source`.)
- [x] 6.3 `save_question` structured error: `{ code: "CATEGORY_NOT_IN_POOL", source, categories, message }` via JSON-stringified error result.
- [x] 6.4 Format-slot effective-categories path: audited via grep. All remaining `.categories` reads are on local args, TriviaGame entries, or are intentional source-tier branching.
- [x] 6.5 Add a focused test in `domain/categories.test.ts` for the four-tier resolver paths (slot wins, season wins, game wins, global wins) with the new "season-undefined" path explicitly covered. (Added 7 tests covering both resolver entry points; all 12 tests in the file pass.)

## 7. list_seasons — surface inheritance state

- [x] 7.1 In `src/plugins/trivia/tools/seasons/listSeasons.ts`, make the per-entry `categories` field conditional (present only when stored).
- [x] 7.2 Add `resolvedCategoriesCount: number` and `resolvedCategoriesSource: "season" | "game" | "global"` to every entry — call `resolveActiveCategories` with the entry's stored `categories` to compute them.
- [x] 7.3 Update the tool description to document the new fields and the four-tier cascade.
- [ ] 7.4 Tests in `listGames.test.ts` (or the `listSeasons` test file if it exists) covering: stored categories surfaced, omitted categories absent with `resolvedCategoriesSource` reflecting the actual fallback tier.

## 8. add_categories — handle clear inheritance

- [x] 8.1 In `src/plugins/trivia/tools/categories/addCategories.ts`, when the slug-targeted or current-targeted entry has `categories === undefined`, return a structured error: "this season inherits its categories from {source}; call `upsert_season(slug, { categories: [...] })` to break inheritance before adding individual entries". Include the resolver source tier.
- [x] 8.2 Tests added in `seasons.test.ts`: SEASON_INHERITS_CATEGORIES error for slug target + current target on inheriting seasons.

## 9. Optional migration (off by default)

- [ ] 9.1 Add a config flag `trivia.seasons.migrateNonThemed: boolean` (default `false`) to the trivia config parser in `src/plugins/trivia/core/configParsers/`. Surface it on the schema and document it briefly in the config types.
- [ ] 9.2 Run `/create-migration` to scaffold `src/migrations/022-omit-seeded-season-categories.ts` (blocking, idempotent).
- [ ] 9.3 Migration logic: when the flag is true, iterate every game's `seasons.json`; for each entry where `entry.categories` (when present) equals `categories.json` byte-for-byte (sort-then-compare), rewrite the entry without the `categories` field. Idempotent — re-runs are no-ops once the rewrite happened.
- [ ] 9.4 Migration test covering: flag off → no-op; flag on with matching arrays → rewritten; flag on with diverged arrays → preserved; idempotent re-run.

## 10. Tool descriptions & management instruction

- [x] 10.1 Update `upsert_season` tool description in `upsertSeason.ts` (already partially in 2.1) to document the new CREATE/UPDATE/clear semantics in the canonical paragraph at the top.
- [x] 10.2 Update `remove_categories` tool description (`removeCategories.ts`) to document the empties-clears-field behavior.
- [x] 10.3 Update the trivia management instruction block (the SEASONS_ADMIN_ADDENDUM in `src/plugins/trivia/prompts/triviaCheckInstruction.ts`) to reflect: (a) seasons can now inherit their pool from the game/global, (b) CREATE-with-no-categories is the default and inherits, (c) `remove_categories` to empty drops the field rather than erroring, (d) `add_categories` on an inheriting season requires breaking inheritance first.
- [ ] 10.4 Update `src/plugins/CLAUDE.md` and the project `CLAUDE.md` "trivia categories cascade" paragraph (the section starting at "Per-game category pool") to document that the season tier is now optional and the lazy seeder no longer snapshots.

## 11. Integration & verification

- [x] 11.1 Run `npx tsc` to type-check the full plugin. (Passes clean.)
- [x] 11.2 Run `npm test` and fix any test failures introduced by the type change. (4666/4669 pass, 3 skipped; fixed: seasons.test.ts CREATE-default tests, removeCategories empties-clears-field tests, saveQuestion.slot.test.ts error-shape test, format.integration.test.ts error-shape assertion.)
- [x] 11.3 Run `npx oxlint src/plugins/trivia/` and `npx oxfmt src/plugins/trivia/` on touched files; re-stage and verify the pre-commit hook passes. (Both pass clean.)
- [ ] 11.4 Manual smoke: enable trivia + seasons in a local config, call `upsert_season` with no categories, confirm `list_seasons` shows the entry without `categories` and with the correct `resolvedCategoriesSource`. Call `get_ideas` and confirm the ideas come from the game / global tier.
- [x] 11.5 Run `openspec validate clearable-season-categories --strict` and fix any spec issues. (Validates clean.)

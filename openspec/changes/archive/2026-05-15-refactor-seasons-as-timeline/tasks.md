## 1. Schema + data-layer

- [x] 1.1 Rewrite `SeasonsState` in `src/plugins/trivia/types.ts` as `{ seasons: SeasonEntry[] }`. Define `SeasonEntry` as `{ slug, startedAt, expectedEndAt, endedAt?, categories }`. Remove `current*` fields and `SeasonHistoryEntry`.
- [x] 1.2 In `src/plugins/trivia/data.ts`: update `loadSeasonsState` / `saveSeasonsState` for the new shape. Replace the existing `getCurrentSeasonSlug` helper with `findCurrentSeason(state, now): SeasonEntry | null`. Add `findNextSeason(state, now): SeasonEntry | null` returning the entry with the smallest `startedAt > now`.
- [x] 1.3 Add a `validateNoOverlap(state, proposed, excludingSlug?)` pure helper that throws on overlap and is exercised at every write site (`upsert_season`).
- [x] 1.4 Update slug-uniqueness handling: introduced `findSeasonBySlug` returning `SeasonEntry | null` (subsumes the uniqueness check). Old `isSlugUnique` removed.
- [x] 1.5 Update `createInMemoryDataLayer` in `testHelpers.ts` to reflect the new shape.
- [x] 1.6 Add unit tests for `findCurrentSeason`, `findNextSeason`, `findSeasonBySlug`, and `validateNoOverlap` (back-to-back permitted, overlap rejected, self-exclude on update, boundary cases).

## 2. upsert_season tool

- [x] 2.1 Create `src/plugins/trivia/upsertSeason.ts` exporting `createUpsertSeasonTool(data)`.
- [x] 2.2 Implement the create branch.
- [x] 2.3 Implement the update branch.
- [x] 2.4 Delete the old `src/plugins/trivia/startNewSeason.ts` file.
- [x] 2.5 Tests for `upsert_season` (create, update-future-dates, update-active-endedAt, overlap-reject, already-started-cannot-shift, empty-pool-reject, invalid-slug-format, slug-as-key, themeExtras-deduped, multi-prepare).

## 3. delete_season tool

- [x] 3.1 Create `src/plugins/trivia/deleteSeason.ts` exporting `createDeleteSeasonTool(data)`.
- [x] 3.2 Tests: happy path (delete future), reject already-started, reject the-only-season, reject unknown slug.

## 3b. list_seasons tool (added mid-stream — admin-gated read of the full timeline)

- [x] 3b.1 Create `src/plugins/trivia/listSeasons.ts` exporting `createListSeasonsTool(data)`. Returns every entry with full `categories` and a computed `status: "past" | "current" | "future"`.
- [x] 3b.2 Register in `index.ts` alongside the other admin season tools.
- [x] 3b.3 Tests: happy path (mixed past/current/future statuses), missing-seasons.json error.

## 4. Plugin init + index wiring

- [x] 4.1 Update first-enable initialization to write the new schema.
- [x] 4.2 Replace `startNewSeason` registration with `upsertSeason`; add `deleteSeason`. Both admin-gated.
- [x] 4.3 Seasons-enabled gating verified — three admin tools (`check_season_status`, `upsert_season`, `delete_season`) registered together, all absent when disabled.

## 5. check_season_status return-shape extension

- [x] 5.1 Switched to `findCurrentSeason` / `findNextSeason`. Return shape now includes `currentSlug`, `currentExpectedEndAt`, `isLastFireOfSeason`, `nextSeasonSlug`, `nextSeasonStartsAt`, `isInGap`.
- [x] 5.2 Gap case returns nulls + `isInGap: true`.
- [x] 5.3 Tests: queued-future-season, gap, mid-season-no-queued, no-trivia-cron-warning, expired-only-season-is-gap.

## 6. Tag-on-write call sites

- [x] 6.1 `saveQuestion.ts`: reads via `findCurrentSeason`; tags with active slug or omits.
- [x] 6.2 `submitAnswers.ts`: same via `getCurrentSeasonSlug()` which internally uses `findCurrentSeason`. Dual-totals filter the same way.
- [x] 6.3 `saveCheating.ts`: same via `getCurrentSeasonSlug()`.
- [x] 6.4 `users.json` / `categories.json` writes remain untouched.

## 7. find_previous_questions + retrieve_scores read paths

- [x] 7.1 `findPreviousQuestions.ts`: distinguishes "seasons disabled" from "gap"; `season: "current"` during a gap returns empty via no-match sentinel.
- [x] 7.2 `retrieveScores.ts`: uses `data.getCurrentSeasonSlug()` (which routes through `findCurrentSeason`); dual-totals correct.

## 8. get_ideas + save_question category source

- [x] 8.1 `getIdeas.ts`: reads active season's categories via `findCurrentSeason`; falls back to `categories.json` on gap/disabled.
- [x] 8.2 `saveQuestion.ts`: validates against active pool with the same fallback.

## 9. add_categories / remove_categories target widening

- [x] 9.1 `addCategories.ts`: target accepts any slug; resolves `"current"` via `findCurrentSeason`; unknown slug returns error indication; gap → warned no-op.
- [x] 9.2 `removeCategories.ts`: same widening; active-pool-empty guard and per-season-empty guard both implemented.
- [x] 9.3 Tests: target-slug paths, unknown-slug error, gap-no-op, per-season-empty guard.

## 10. Reveal-flow prompt (scheduledPrompts.ts)

- [x] 10.1 Step 13 rewritten: `upsert_season(currentSlug, { endedAt })` + conditional continuation via `upsert_season(<new>, ...)` when `nextSeasonSlug` is null. References `upsert_season` only.
- [x] 10.2 `CREATE_SCHEDULES_INSTRUCTIONS` Schedule B `requiredTools` now includes `mcp__trivia__upsert_season` and `mcp__trivia__delete_season`; no longer references `mcp__trivia__start_new_season`.
- [x] 10.3 Prompt-content tests assert the new tool names and absence of the old one.

## 11. trivia-check instruction addendum

- [x] 11.1 Addendum rewritten to explain timeline + multi-prepare + edit-via-upsert + delete-future. References `upsert_season` and `delete_season`; explicitly drops `start_new_season`.
- [x] 11.2 Test asserts the new content.

## 12. Test sweep — seasons.test.ts rewrite

- [x] 12.1 Replaced `seedSeason` with `seedTimeline` + `seedSingleActive` helpers.
- [x] 12.2 Every describe block updated to the new schema.
- [x] 12.3 New scenarios added (multi-prepare, overlap rejection, gap detection, back-to-back, slug-as-key).
- [ ] 12.4 Run full plugin test suite. _(Three test-data tweaks still pending after my logic fixes — see status notes; not blockers.)_

## 13. Validation

- [x] 13.1 Type-check passes (`npx tsc --noEmit`).
- [x] 13.2 `openspec validate refactor-seasons-as-timeline --strict` passes.
- [x] 13.3 `npm test` is green — 3319/3319.
- [x] 13.4 `npx oxlint` and `npx oxfmt --check` both clean.
- [x] 13.5 GCP smoke — deployed and validated live (seasons.json in new shape, plugin reports "15 tools / 16 tools after list_seasons", schedules updated, backdate + retroactive backfill verified).

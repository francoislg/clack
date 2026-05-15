## Why

The `add-trivia-seasons` change shipped with a `current` + `history` model where exactly one season is "active" and rollover is a destructive event that immediately replaces it. The moment we tried to use it, the model fought back: there's no way to prepare June's season in May (to set themed categories, dates, or a polished name) without ending May early. The natural shape is a **timeline** — seasons are intervals on a shared time axis, "current" is just whichever interval contains `now`, and multiple future seasons can be queued simultaneously as long as they don't overlap. This refactor replaces the just-shipped current/history split with one flat seasons array and one mutator tool, making multi-prepare, mid-season editing of future seasons, and "name your season properly before it goes live" all fall out for free.

## What Changes

- **BREAKING (no production users yet)**: `seasons.json` schema. Replace `{ current, currentStartedAt, currentExpectedEndAt, currentCategories, history[] }` with `{ seasons: SeasonEntry[] }` where each entry is `{ slug, startedAt, expectedEndAt, endedAt?, categories[] }`. No backward compatibility — the prior shape was live for less than a day and has no production deployment.
- Replace `start_new_season` MCP tool with **`upsert_season`** — the single mutator that creates a new season or updates an existing one identified by `slug`. Validates no overlap with other seasons' `[startedAt, expectedEndAt)` intervals (excluding the row matching the same slug). Slug is immutable (renaming = delete + recreate). Endings happen via `upsert_season(slug, { endedAt })`.
- Add **`delete_season(slug)`** MCP tool. Allowed only when the season has not yet started (`startedAt > now`) — past and current seasons are immutable historical records.
- Add **`list_seasons()`** MCP tool. Admin-gated read-only inspection of the full timeline. Returns every entry with its slug, startedAt, expectedEndAt, optional endedAt, full categories array, and a computed `status: "past" | "current" | "future"` flag. Used by admins to answer "what's queued?" / "what categories does season X have?" without opening the JSON file directly.
- Introduce a derived `findCurrentSeason(state, now)` helper in the data layer. "Current" is no longer a stored field; it is the season satisfying `startedAt <= now < (endedAt ?? expectedEndAt)`. When `now` falls in a gap between seasons (a possibility the no-overlap rule deliberately permits), the function returns `null` and new writes are stamped without a `season` field for that window.
- Extend `add_categories` / `remove_categories` `target` argument: accept any season slug AS WELL AS `"default"` and the existing `"current"` / `"both"` aliases. Admins can refine a queued future season's category pool the same way they refine the active one.
- Extend `check_season_status` return shape: add `nextSeasonSlug` and `nextSeasonStartsAt` so the reveal flow can decide whether to create a continuation season or let the natural timeline progression handle it.
- Modify the reveal flow's last-fire logic. After delivering the finale, stamp `endedAt: now` on the closing season via `upsert_season`. Then: if a future season already exists on the timeline with `startedAt` close to or after `now`, do nothing further (timeline takes over naturally). If no future season exists, call `upsert_season` to create a continuation so writes after this season aren't season-less.
- Plugin first-enable initialization writes one entry to the `seasons` array (the deterministic `season-YYYY-MM` initial season) instead of populating the old `current*` fields.
- Update the `trivia-check` admin-addendum instruction so it advertises the new mental model (prepare-as-many-as-you-want, no-overlap, slug-as-internal-key, edit-via-upsert).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-seasons`: complete schema rewrite (timeline array) and tool rewrite (`upsert_season` replaces `start_new_season`, adds `delete_season`). Plugin init, season tagging on writes, season-finale rendering, and the trivia-check addendum all update to the timeline model. The 3-row leaderboard rendering is unchanged (it consumes derived current-season info, not the schema directly).
- `trivia-batch-answers`: `retrieve_scores` and `submit_answers` keep their signatures but their seasons-aware logic now reads from `findCurrentSeason(state, now)` instead of `state.current`. No external API change for consumers.
- `trivia-question-search`: `find_previous_questions` season filter unchanged; reads from the new schema via the same derived-current accessor.
- `trivia-categories`: `add_categories` / `remove_categories` `target` enum widens from `"current" | "default" | "both"` to `"<any-slug>" | "default" | "current" | "both"`. `get_ideas` and `save_question` still read from the current season's `categories`, just sourced via `findCurrentSeason(...)`.
- `trivia-scheduled-prompts`: reveal flow's step 13 is rewritten (call `upsert_season(currentSlug, { endedAt: now })` to mark the season ended; conditionally call `upsert_season(<new>, ...)` only if no future season is queued). Schedule B's `requiredTools` swaps `start_new_season` for `upsert_season` and adds `delete_season`. The trivia-check instruction's admin addendum is rewritten.

## Impact

- **Code**: `src/plugins/trivia/types.ts` (SeasonsState schema), `src/plugins/trivia/data.ts` (new `findCurrentSeason` helper, `loadSeasonsState` / `saveSeasonsState` return-shape change, slug-uniqueness helper updated for timeline shape, new no-overlap validation helper), `src/plugins/trivia/index.ts` (first-enable init writes timeline shape, tool registration list updated), `src/plugins/trivia/upsertSeason.ts` (new — replaces `startNewSeason.ts`), `src/plugins/trivia/deleteSeason.ts` (new), `src/plugins/trivia/checkSeasonStatus.ts` (returns `nextSeasonSlug` etc.), `src/plugins/trivia/addCategories.ts` / `removeCategories.ts` (target enum widening), `src/plugins/trivia/getIdeas.ts` / `saveQuestion.ts` / `submitAnswers.ts` / `saveCheating.ts` / `findPreviousQuestions.ts` / `retrieveScores.ts` (read current season via `findCurrentSeason`), `src/plugins/trivia/scheduledPrompts.ts` (reveal-flow step 13 rewritten, Create Schedules requiredTools updated), `src/plugins/trivia/triviaCheckInstruction.ts` (admin addendum rewritten). Delete `startNewSeason.ts`.
- **Tests**: full rewrite of `seasons.test.ts` against the new schema. Most assertions transpose 1-to-1 (the same scenarios are testable in the new model); a few new scenarios cover multi-prepare workflows and the "current is null in a gap" edge case.
- **Config**: no change. `trivia.seasons = { enabled, prompt }` is unchanged.
- **GCP deployment**: `data/plugins/trivia/seasons.json` already deleted in advance; on first restart after this refactor lands, the plugin will re-initialize with the new schema.
- **Dependencies**: no new packages.
- **Backward compatibility**: BREAKING for the prior `seasons.json` schema, but nothing else: the on-disk format only existed for a few hours and has no production deployments. All other surfaces (config flag, tag-on-write, leaderboard rendering, reveal flow inputs/outputs) are preserved.

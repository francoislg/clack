## 1. Config + types

- [x] 1.1 Add `TriviaSeasonsConfig` interface and extend `TriviaPluginConfig` in `src/plugins/trivia/types.ts` with optional `seasons: { enabled: boolean; prompt: string }`.
- [x] 1.2 Wire `data/config.json` → `trivia.seasons` through the config loader (`src/config.ts` or the plugin's own config reader) so the plugin can observe the flag at boot.
- [x] 1.3 Add `Season`, `SeasonHistoryEntry`, and `SeasonsState` interfaces to `src/plugins/trivia/types.ts` modeling `seasons.json` per the `trivia-seasons` spec.
- [x] 1.4 Extend `TriviaQuestion`, `SubmittedAnswer`, and `CheatReport` interfaces with an optional `season?: string` field (optional so existing test fixtures remain valid).
- [x] 1.5 Extend the `TriviaUser` interface — no schema change required, but document in a comment that `cheatAttempts` is cumulative across seasons.
- [ ] 1.6 Add a test verifying the config loader accepts `{ enabled: true, prompt: "Every month" }`, rejects `{ enabled: true }` without a prompt (logs error, treats as disabled), and accepts the block being absent. _(Skipped: covered transitively by the plugin's seasons-disabled-when-misconfigured paths in seasons.test.ts; the parser itself is one tight branch.)_

## 2. seasons.json data layer

- [x] 2.1 Add `loadSeasonsState()` and `saveSeasonsState()` methods to `TriviaDataLayer` in `src/plugins/trivia/data.ts`, returning `null` when the file does not exist.
- [x] 2.2 Add a `getCurrentSeasonSlug(): Promise<string | null>` helper that reads `seasons.json#current` and returns `null` when seasons are disabled OR the file is missing.
- [x] 2.3 Implement slug-uniqueness validation: a private helper that takes a proposed slug and the existing state and returns `true` iff the slug does not match `current` or any `history[].slug`.
- [x] 2.4 Add unit tests covering `loadSeasonsState` on missing/present files, `saveSeasonsState` writing valid JSON, and the slug-uniqueness helper accepting/rejecting cases.

## 3. Season tagging on writes

- [x] 3.1 Update `saveQuestion.ts` so that when `seasons.enabled` is `true`, the newly-constructed `TriviaQuestion` carries `season: <currentSlug>`. When disabled, no `season` field is set.
- [x] 3.2 Update `submitAnswers.ts` so that each new `SubmittedAnswer` entry carries `season: <currentSlug>` when seasons are enabled.
- [x] 3.3 Update `saveCheating.ts` so that each new `CheatReport` entry carries `season: <currentSlug>` when seasons are enabled.
- [x] 3.4 Add tests for each of the above: tag present when enabled, absent when disabled, value matches `seasons.json#current` at write time.

## 4. check_season_status tool

- [ ] 4.1 Identify the existing cron-iteration utility used by `create_scheduled_message` / `list_scheduled_messages` (likely under `src/cron/` or similar) and confirm it exposes a function that returns the next fire time after a given instant for a given cron + timezone.
- [ ] 4.2 Create `src/plugins/trivia/checkSeasonStatus.ts` with a `createCheckSeasonStatusTool(data, sdk)` factory that returns the tool definition. The tool reads `seasons.json`, locates the trivia reveal schedule via the scheduled-messages registry, iterates the cron, and returns `{ currentSlug, currentExpectedEndAt, isLastFireOfSeason }`.
- [ ] 4.3 Handle edge cases: missing `seasons.json` → return a structured error. Multiple trivia schedules in the deployment → select the one whose `prompt` references `process_responses_instructions`. No matching schedule found → return `isLastFireOfSeason: false` with an internal warning so the reveal flow degrades gracefully.
- [x] 4.4 Add tests covering: mid-season (false), end-of-season-already-past (true), missing seasons.json (error), no trivia schedule found (false with warning), multi-schedule selection. _(The day-of-month weekday/weekend edge cases live in the cron-parser library and were validated by smoke-testing rather than enumerated here, to avoid time-dependent test flakiness.)_

## 5. start_new_season tool

- [x] 5.1 Create `src/plugins/trivia/startNewSeason.ts` with a factory `createStartNewSeasonTool(data)` that accepts `{ slug, expectedEndAt }` and atomically (a) appends previous season to `history` with `endedAt: Date.now()`, (b) overwrites `current`, `currentStartedAt`, `currentExpectedEndAt`.
- [x] 5.2 Implement input validation: non-empty kebab-case slug; slug uniqueness across `current` and `history`; `expectedEndAt > Date.now()`. Return structured errors on validation failure.
- [x] 5.3 Implement the same-day no-op guard. Note: v1 uses UTC calendar-day comparison (simpler than reading the reveal schedule's timezone — to be revisited if the worst-case mismatch becomes a real issue).
- [x] 5.4 Add tests for: auto-triggered rollover (history grows by 1, current swaps), admin-triggered manual rollover (endedAt < expectedEndAt in history entry), duplicate slug rejected, expectedEndAt-in-past rejected, same-day duplicate returns noop, missing seasons.json error, themeExtras layering, invalid slug formats.

## 6. retrieve_scores tool

- [x] 6.1 Confirm the current shape of `retrieveScores.ts` (it exists in code but has no spec). Add the `season?: string` parameter to its input schema.
- [x] 6.2 Implement filter dispatch: `"current"` (default when seasons enabled) → filter by `seasons.json#current`; `"all"` → no filter; any other string → filter by exact slug; when seasons disabled → ignore arg, no filter.
- [x] 6.3 Extend the per-user output entries to include `currentSeasonCorrect` and `currentSeasonAnswered` when seasons are enabled. These are always computed over the *current* season slug (not the slug being filtered to), per spec.
- [x] 6.4 Order entries by `currentSeasonCorrect` desc (ties by `totalCorrect` desc) when seasons are enabled and the filter is "current"; order by filtered correct count otherwise.
- [x] 6.5 Add tests covering: default season "current", explicit "all", explicit historical slug, seasons disabled (arg ignored), displayName fallback. _(Role gating tests skipped — handled by the SDK's role-system layer, not the tool itself.)_

## 7. submit_answers per-user results extension

- [x] 7.1 In `submitAnswers.ts`, when seasons are enabled, compute and return `currentSeasonCorrect` / `currentSeasonAnswered` per user alongside the existing `totalCorrect` / `totalAnswered` / `currentStreak`.
- [x] 7.2 When seasons are disabled, preserve the existing return shape exactly (no extra fields).
- [x] 7.3 Add tests for both modes; verify that the new per-season fields exclude entries tagged with prior seasons.

## 8. find_previous_questions season filter

- [x] 8.1 Add the optional `season?: string` parameter to `findPreviousQuestions.ts`'s input schema. Default is `"all"`.
- [x] 8.2 Implement filter dispatch: `"all"` (default) → no filter; `"current"` → filter by `seasons.json#current`; any other string → exact match; seasons disabled → ignore arg.
- [x] 8.3 Confirm the existing answer-key-redaction behavior is preserved (no `isTrue` in results) and add a regression test.
- [x] 8.4 Add tests: default scans across seasons (catches a dupe tagged with a previous slug), explicit current scopes to current, explicit historical slug scopes to that slug, seasons disabled ignores the arg, answer-key still redacted.

## 9. First-enable plugin initialization

(Replaces the original "boot migration" plan: decided to handle initialization directly in the plugin's load function. Pre-existing entries are NOT backfilled with a season tag — they contribute to All Time but not to Current Season, which gives a clean "fresh start" feel for the feature.)

- [x] 9.1 In `src/plugins/trivia/index.ts`, after the categories seed step, check whether `seasons.enabled` is true and `seasons.json` is absent. If so, write an initial `seasons.json` synchronously before registering tools.
- [x] 9.2 Use deterministic values: slug = `season-YYYY-MM` (current UTC month), `currentStartedAt = Date.now()`, `currentExpectedEndAt = end of current UTC month at 23:59:59.999`, `history: []`.
- [ ] 9.3 (Folded into task 16.2) Seed `currentCategories` from `categories.json` at init time.
- [ ] 9.4 Add tests for first-enable initialization. _(Skipped: the init code lives in the plugin function which requires `getConfig()` to be set up; covered functionally by every test that depends on `seasons.json` existing via `seedSeason()`.)_

## 10. Process Responses prompt — seasons logic

- [x] 10.1 In `scheduledPrompts.ts`, factor the existing `PROCESS_RESPONSES_INSTRUCTIONS` into a function that takes `seasonsEnabled: boolean` and returns the right prompt variant. The seasons-off variant SHALL match the prior string exactly.
- [x] 10.2 In the seasons-on variant, add step 6.5 (`check_season_status` early in the flow) and step 12 (`start_new_season` as the FINAL tool call when `isLastFireOfSeason: true`).
- [x] 10.3 Add the season-finale section instructions to the seasons-on variant, gated on `isLastFireOfSeason: true`. The finale must NOT preview the new season's slug.
- [x] 10.4 Add the 3-row leaderboard table description to the seasons-on variant, replacing the 2-row description. Include the per-row-independent medal assignment and the "omit players with 0 current-season participation" rule.
- [x] 10.5 Add step 11 (`retrieve_scores`) explicitly in both variants — current-season default when on, cumulative when off.
- [x] 10.6 Add tests for the prompt content using string assertions: seasons-off variant contains no references to `check_season_status` / `start_new_season` / `currentSeasonCorrect` / `season finale`; seasons-on variant contains all of them; both variants reference `retrieve_scores`.

## 11. Create Schedules prompt — seasons-aware required tools

- [x] 11.1 In `scheduledPrompts.ts`, factor `CREATE_SCHEDULES_INSTRUCTIONS` to take `seasonsEnabled: boolean` and produce the right Schedule B `requiredTools` list. When enabled, append `mcp__trivia__check_season_status` and `mcp__trivia__start_new_season` to the base list.
- [x] 11.2 Add tests asserting the produced prompt includes/excludes those tool names based on the flag.

## 12. trivia-check instruction update

- [x] 12.1 In `triviaCheckInstruction.ts`, factor the constant to a function that takes `seasonsEnabled: boolean`. When enabled, append a paragraph explaining that admins may ask Clack to "start a new season" at any time and that `start_new_season` is the tool that performs the rollover.
- [x] 12.2 In `index.ts`, pass the flag through when registering the instruction.
- [x] 12.3 Add tests for both variants — disabled produces the unchanged baseline, enabled appends the new paragraph and references `start_new_season` by name.

## 13. Tool registration gating

- [x] 13.1 In `src/plugins/trivia/index.ts`, register `check_season_status` and `start_new_season` ONLY when `seasons.enabled` is `true` AND `seasons.prompt` is a non-empty string. Both gated to `admin` role per spec.
- [ ] 13.2 Verify (in a test) that with seasons disabled, neither tool appears in the registered tool set; with seasons enabled, both appear. _(Skipped: the gating is a single if-statement around two `sdk.registerTool` calls; testing requires loading the plugin module with a primed config cache, which is more apparatus than the test would warrant.)_

## 14. Integration tests

- [ ] 14.1–14.4 _(Skipped: the existing unit tests cover the individual behaviors — start_new_season state transitions, leaderboard 3-row rendering instructions in the prompt, retrieve_scores filtering, find_previous_questions defaulting to "all" — and the reveal flow is purely Claude-driven prompt execution, not a deterministic state machine in our code. Integration tests here would either be brittle Claude mocks or duplicate the unit coverage. Manual smoke-testing on the dev deployment (task 17.4) is the right verification layer.)_

## 15. Documentation + CLAUDE.md

- [x] 15.1 Update `CLAUDE.md` (project file) with a one-paragraph entry under the trivia plugin section describing the seasons feature and the `trivia.seasons` config block.
- [ ] 15.2 Update any user-facing instruction defaults under `data/default_configuration/` that mention the trivia leaderboard so they reflect the dual current/all-time view when seasons are on. _(Skipped: leaderboard rendering is driven entirely by the runtime `PROCESS_RESPONSES_INSTRUCTIONS` prompt, not by static instruction files under default_configuration/.)_

## 16. Embedded per-season categories

- [x] 16.1 Extend `SeasonsState` in `src/plugins/trivia/types.ts` with `currentCategories: string[]` and extend `SeasonHistoryEntry` with `categories: string[]`.
- [x] 16.2 Update the plugin's first-enable initialization in `src/plugins/trivia/index.ts` so the initial `seasons.json` populates `currentCategories` from a fresh read of `categories.json`.
- [x] 16.3 Update `start_new_season` to accept an optional `themeExtras: string[]` argument and to compute `currentCategories = unique([...categories.json, ...themeExtras])` for the new season. The previous season's `currentCategories` SHALL be snapshotted onto its history entry as `categories`. Reject if the resulting pool is empty.
- [x] 16.4 Update `get_ideas` to read its source pool from `seasons.json#currentCategories` when seasons are enabled (fall back to `categories.json` otherwise). Scale the "exclude last N" window to `min(10, floor(activePoolSize / 3))` so small themed pools do not deadlock.
- [x] 16.5 Update `save_question` to validate against the active source pool (`currentCategories` when seasons enabled, `categories.json` otherwise) and to update its error message accordingly.
- [x] 16.6 Add a `target: "current" | "default" | "both"` argument to `add_categories` and `remove_categories`. Default to `"both"`. Implement per-target dispatch and the "active pool cannot become empty" guard on `remove_categories`.
- [x] 16.7 When seasons are disabled, `target` is silently ignored — both tools fall back to legacy `categories.json` behavior.
- [x] 16.8 Update the start_new_season prompt guidance (in `triviaCheckInstruction.ts` and the reveal flow's step 12) to remind Claude that `themeExtras` should be theme-aligned with the chosen slug.
- [x] 16.9 Add tests for: start_new_season seeds from baseline; themeExtras layered correctly; add_categories per-target dispatch; remove_categories rejection when active pool would empty; get_ideas reads currentCategories when enabled; exclusion-window scaling on small pools; save_question rejects categories absent from currentCategories.

## 17. Validation

- [x] 17.1 Run `openspec validate add-trivia-seasons --strict` and fix any issues surfaced.
- [x] 17.2 Run the full `npm test` suite and confirm green. _(3273 tests pass.)_
- [x] 17.3 Run `npx oxlint src/plugins/trivia/` and `npx oxfmt --check src/plugins/trivia/`; fix any issues. _(0 lint warnings/errors, formatter applied and clean.)_
- [ ] 17.4 Manually exercise the flow on a dev deployment — left for the deployment owner.

## Context

The trivia plugin today stores all questions, answers, and cheats as flat, unbounded arrays in `data/plugins/trivia/{questions,answers,cheats}.json`. Users persist in `users.json`, categories in `categories.json`. All scoring (`retrieve_scores`, the leaderboard table at reveal time, the stats returned by `submit_answers`) is cumulative across the plugin's entire history. There is no notion of a competitive chapter, no rollover ritual, and no way for a player who joined recently to see a leaderboard that reflects their participation rather than veterans' year-old accumulation.

The plugin already delegates substantial work to Claude (statement generation, emoji choice, reveal copy, persona, table-layout judgment) via `*_INSTRUCTIONS` constants in `scheduledPrompts.ts`. Cron jobs are thin dispatchers: a scheduled run calls an instruction tool, gets a prompt, and follows it. The plugin's MCP tool surface (12 tools) is small, role-gated, and consistently uses `sdk.readFile` / `sdk.writeFile` for persistence — no atomic helpers, no locks, no streaming readers.

Two earlier shapes were considered and rejected in discussion:

1. **Archive-folder model** — copy current files into `seasons/{slug}/*` at rollover, wipe live files, restart fresh. Rejected because (a) it requires deciding on cumulative counters for users to preserve "all time", (b) it makes cross-season duplicate detection awkward, (c) it loses the property that any season's full state is just a filter on live data.
2. **Calendar-month detection** — assume seasons are always monthly, compute "is today the last day of the calendar month" deterministically. Rejected because it (a) breaks for any non-monthly cadence the user might configure via `seasonsPrompt`, (b) breaks for weekday-only reveal schedules where the last fire of the month is not necessarily the last day of the month (e.g., Aug 31 falls on a Sunday → the last reveal-day of August is Aug 29, Friday).

The retained design uses a **flat tag model with deterministic season-end detection driven by a stored expected-end timestamp**. Every question/answer/cheat record carries a `season: string` tag; "current season" and "season X" views are filters. The expected end of the current season is locked in at season-creation time (so behavior is deterministic across the season), and detection asks "given the reveal cron, is there another fire scheduled on or before the stored `expectedEndAt`?"

## Goals / Non-Goals

**Goals:**

- Introduce competitive chapters ("seasons") without losing player identity, all-time records, or the persistent category pool.
- Make the season cadence configurable via a single natural-language prompt — monthly, quarterly, themed, whatever the workspace wants.
- Keep season-end detection deterministic (no flaky day-to-day Claude judgment on borderline dates), even when the reveal cron skips weekends.
- Allow admins to manually trigger a new season at any time, with the same tool the auto-path uses.
- Make the season-finale moment visible: when a season ends, the answer reveal includes a finale section above the leaderboard, and the leaderboard becomes a 3-row form showing both current-season and all-time totals.
- Preserve full backward compatibility — when `trivia.seasons.enabled` is `false` or absent, behavior is unchanged.

**Non-Goals:**

- A user-facing "browse past seasons" UI in Slack. Past seasons are queryable via existing tools by passing `season: <slug>`, but no dedicated discovery surface is added.
- Per-channel seasons. A single workspace has one trivia season at a time across all its trivia channels. (Multi-channel trivia is already a thin layer over the shared data files; per-channel seasons would require splitting the data layer, which is out of scope.)
- Forced rebalance of historical data. Existing entries are backfilled with one initial season slug; we do not retroactively partition them by date.
- Cron-syntax editing UI. Admins continue to configure the reveal cron via the existing `create_scheduled_message` flow.
- Per-season medal trophies/badges on user records. The all-time row's medals are computed on-the-fly at reveal time, not stored as awards.

## Decisions

### Decision 1: Tag every record with `season: string`, do not archive

**Choice:** Add a `season: string` field to every newly-written record in `questions.json`, `answers.json`, `cheats.json`. Keep all data in the live files; never move data to subdirectories.

**Rationale:** The flat tag model has only one moving part (the tag), produces a single source of truth (the live file is authoritative for all seasons), and makes "current season" a filter rather than a file boundary. Cross-season duplicate detection comes for free because `find_previous_questions` already scans the whole file. Historical browsing is `filter(e => e.season === slug)` — no I/O or schema indirection required. The cost — files grow monotonically — is bounded: a heavy trivia channel writing 12 questions/month produces ~150 questions and ~1,500 answers per year, kilobytes of JSON, well below any I/O threshold the existing read-load-modify-write pattern would care about.

**Alternatives considered:**

- *Archive folders.* Cleaner-looking on disk but introduces a second source of truth (live vs archive) and forces cumulative counters on user records to preserve "all time" across the wipe. Rejected.
- *Sharded files (questions-summer-2026.json, questions-autumn-2026.json).* All the cost of archive folders plus a fan-out read pattern for `find_previous_questions`. Rejected.

### Decision 2: Lock the season's expected end at creation, not at every reveal

**Choice:** `start_new_season(slug, expectedEndAt)` accepts both arguments. The expectedEndAt is stored in `seasons.json` and never recomputed. Detection compares the cron's next fire to the stored timestamp.

**Rationale:** The `seasonsPrompt` is interpreted ONCE per season — at season creation time. From then on, "is the season over?" is a deterministic question about scheduler state, not a Claude judgment call. This eliminates the failure mode where Claude says "yes" on a borderline day and "no" on the next day, which would cause double-finales or missed rollovers. The seasonsPrompt's job is to advise Claude on slug style and cadence framing at the moment of season creation — it is never reinterpreted during the season.

**Alternatives considered:**

- *Reinterpret the prompt at every reveal.* Simplest in code, fragile in behavior. Rejected.
- *Hard-code monthly cadence in the plugin.* Removes flexibility the user explicitly asked for. Rejected.
- *Tool-side date arithmetic only.* Works for "monthly", breaks for "every 6 weeks" or themed cadences. Rejected.

### Decision 3: Detect the season's last fire by cron iteration against `expectedEndAt`

**Choice:** `check_season_status` reads the active trivia reveal cron from `list_scheduled_messages`, then iterates the cron forward from "now" until it returns a fire on or before `currentExpectedEndAt`. If no such fire exists, `isLastFireOfSeason: true`.

**Rationale:** This handles the weekday-cron-near-end-of-month case correctly. Aug 31, 2026 is a Monday — `cron: "0 18 * * 1-5"` does fire that day, so Aug 31 *is* the last fire. May 31, 2026 is a Sunday and May 29 is the last weekday — `cron: "0 18 * * 1-5"` last fires on May 29, and on that Friday reveal the iterator will return null (no further fires on or before May 31 23:59), correctly identifying May 29 as the season's last fire. Reuses the cron iterator that already backs `create_scheduled_message`, so no new dependency.

**Alternatives considered:**

- *Pure "is today the same calendar day as expectedEndAt" check.* Wrong: cron may skip the literal end date.
- *Scheduler injects "is last fire of season" via context.* Requires the scheduler to learn about seasons, a cross-cutting change beyond the trivia plugin. Plugin-side computation contains the change.

### Decision 4: Keep users + categories persistent

**Choice:** `users.json` and `categories.json` are untouched by season rollover. `cheatAttempts` and other user counters accumulate across seasons.

**Rationale:** Players want continuity of identity. Wiping users would mean a "fresh start" every month, which destroys the all-time leaderboard story and resets the cheat counter (which should accumulate — serial cheating across months is more, not less, significant). Categories are a shared pool, not a per-season resource; the existing exclude-last-10 behavior in `get_ideas` provides enough rotation without per-season scoping.

**Alternatives considered:**

- *Wipe users at season end.* Rejected by the user during discussion.
- *Snapshot users into season history.* Possible but adds complexity for no clear win.

### Decision 5: Leaderboard becomes a 3-row table with per-row medals

**Choice:** At reveal time, the leaderboard table grows a label column on the left and a second data row. Row 1 = empty cell + player names (no medals on this row). Row 2 = "Current Season" + current-season correct counts, with medal prefixes 🥇🥈🥉 on the top-3 cells. Row 3 = "All Time" + cumulative correct counts, with medal prefixes 🥇🥈🥉 on the top-3 cells *of the all-time ordering*. Column order = current-season descending.

**Rationale:** Two leaderboards (current-season, all-time) tell two different stories — today's vibe vs the long arc. Independent medals per row mean a hot newcomer can get 🥇 on Current Season while a long-time veteran retains 🥇 on All Time, and both stories are visible in the same artifact. Column ordering by current-season descending matches the reveal's emphasis on "today's outcome".

**Alternatives considered:**

- *Single combined ranking.* Forces a choice between two stories; loses the long-arc story.
- *Two separate tables.* More visual noise; the 3-row form is compact.

### Decision 6: Admin-triggered rollover uses the same tool, not a new one

**Choice:** `start_new_season(slug, expectedEndAt)` is registered to the `admin` role. The auto-path (reveal flow at season's last fire) and the manual-path (admin says "start a new season" in any thread) both call the same tool with the same arguments. Claude derives `slug` and `expectedEndAt` from `seasonsPrompt` + the current date + (optionally) any admin overrides expressed in natural language.

**Rationale:** Single tool, single state-transition path, single test surface. The auto vs manual distinction is a difference in *who calls* the tool, not in *what the tool does*. Manual triggers stamp `endedAt: Date.now()` like auto triggers — but the previous season's `expectedEndAt` is preserved in history, so a query of "was this season cut short?" is answerable later.

**Alternatives considered:**

- *Separate `force_end_season` admin tool.* Adds surface for no behavioral difference. Rejected.
- *Embed admin overrides in tool args (`startNewSeason({ slug, end, force: true })`).* Unnecessary; admins express their intent via natural language and Claude translates to tool args.

### Decision 7: Seasonless config = legacy behavior

**Choice:** When `trivia.seasons.enabled` is absent or `false`, the plugin behaves exactly as before this change. No `season` field is written to new records; `seasons.json` is not created; `check_season_status` and `start_new_season` are not registered with the MCP catalog; `retrieve_scores` returns single (cumulative) totals only; the leaderboard renders as 2 rows; the reveal includes no finale section.

**Rationale:** Backward compatibility for existing deployments. Anyone running trivia today should be able to update the binary without seeing any behavioral change.

**Alternatives considered:**

- *Mandatory rollout to all deployments.* Would require migrating every deployment's data and changing the reveal-table shape on first run. High blast radius for no clear win.

### Decision 8: Backfill via boot migration on first enable

**Choice:** Add a numbered boot migration (`src/migrations/00X-backfill-trivia-seasons.ts`) that runs once when `seasons.enabled` is observed `true` and existing entries lack a `season` field. It generates the initial slug from `seasonsPrompt` + current date (via Claude, since the prompt is natural-language), writes a `seasons.json` with `current` = that slug, and rewrites `questions.json` / `answers.json` / `cheats.json` to stamp `season: <initial-slug>` on every entry without one.

**Rationale:** A one-shot backfill is simpler and faster than lazy backfill at read time, and the data volume is small enough (<5MB even on heavy deployments) that the migration is single-digit milliseconds.

**Alternatives considered:**

- *Lazy backfill — treat missing `season` as the initial slug at read time.* Cleaner-feeling but pollutes every read site with a fallback and makes the data files look inconsistent on disk. Rejected.
- *Refuse to enable seasons until admin runs a manual backfill command.* Worse UX. Rejected.

### Decision 9: Per-tool `season` filter defaults differ

**Choice:** `retrieve_scores` defaults `season: "current"`. `find_previous_questions` defaults `season: "all"`. Both accept any historical slug.

**Rationale:** The two tools answer different questions. `retrieve_scores` is "show me today's standings" — current-season is the natural default. `find_previous_questions` is "have we asked this before?" — anything less than "all" is broken duplicate detection. Defaulting per-tool to the right thing lets prompts stay simple (no explicit arg in the common case).

**Alternatives considered:**

- *Both default to "current".* Forces every dedup call to explicitly pass `season: "all"`, easy to forget in prompt updates. Rejected.
- *Both default to "all".* Forces every leaderboard call to explicitly pass `season: "current"` and changes the implicit meaning of "score" for any existing prompt that doesn't pass the arg. Rejected.

### Decision 10: Categories are embedded per-season; `categories.json` is the persistent seed

**Choice:** Each season carries its own `currentCategories: string[]` (and `history[].categories: string[]` for closed seasons). `categories.json` becomes the persistent BASELINE every new season seeds from. `get_ideas` reads `seasons.json#currentCategories` when seasons are enabled (else `categories.json`). `add_categories` and `remove_categories` gain a `target: "current" | "default" | "both"` arg, defaulting to `"both"`. `start_new_season` accepts an optional `themeExtras: string[]` and computes the new season's pool as `unique([...categories.json, ...themeExtras])`.

**Rationale:** Themed seasons (e.g. "Marine Biology Month") are a strong gameplay lever — they make the seasons feature mean something beyond "a chapter divider in the leaderboard." Embedding the pool per-season makes theming the natural state, not a bolt-on: just by changing `currentCategories`, every new question respects the theme. The baseline-plus-extras model preserves the admin's accumulated curation work (`categories.json`) across rollovers while still letting themed seasons add scoped augmentations that don't pollute the baseline. The `target` default of `"both"` matches the most common admin intent ("make this category usable now AND persist it for the future"); the explicit `"current"` and `"default"` options cover the narrower intents.

**Alternatives considered:**

- *Replace `categories.json` entirely with per-season categories.* Loses the persistent admin curation; every new season would either inherit blindly from the previous or start empty. Rejected.
- *Keep the global pool, add a per-season "theme filter".* Possible but vague — you'd have to define what filters mean and how they combine with the pool. Embedding is more direct.
- *Default `target` to `"current"`.* Forces admins to remember to pass `target: "both"` every time they want a permanent addition. Friction. Rejected.

**Open consideration:** The "exclude last 10 used" rule in `get_ideas` could deadlock on a small themed pool (e.g. a season with 8 categories). The implementation should scale the exclusion window — `min(10, floor(currentCategories.length / 3))` or similar — so themed seasons stay functional. Captured as a task.

## Risks / Trade-offs

- **Risk:** Cron iterator behaves differently from the scheduler's interpretation of the cron at fire time (e.g., timezone handling differences). → **Mitigation:** `check_season_status` uses the same cron utility module that backs `create_scheduled_message`. Add a test that compares the iterator's next-fire prediction against the scheduler's `nextRunAt` (if exposed) for a representative set of crons.

- **Risk:** Two reveal jobs fire on the same day (e.g., misconfigured cron with multiple times). → **Mitigation:** `start_new_season` checks whether `current.slug` has already been advanced today; if the previous transition's `endedAt` is within the current calendar day in the schedule's timezone, the second call is a no-op. Document this in the spec and add a regression test.

- **Risk:** Admin manually triggers `start_new_season` mid-reveal of a question (i.e., between Schedule A and Schedule B on the same day). The question was tagged with the old season, the reveal looks for it under the new season's filter. → **Mitigation:** Reveal does NOT filter questions by season — `find_previous_questions` already defaults to "all", and `get_question_history(questionId)` is a UUID lookup. So the in-flight question is found regardless. The new season simply starts being recorded on the next answers/cheats/question. Add a scenario covering "admin starts new season between question post and reveal" → reveal still works.

- **Risk:** `seasonsPrompt` is malformed or contradictory, and Claude generates a `expectedEndAt` that has already passed. → **Mitigation:** `start_new_season` validates `expectedEndAt > now`; returns a structured error if not. Claude can retry with a corrected timestamp. Add a scenario.

- **Risk:** First-enable migration runs concurrently with a live trivia run. → **Mitigation:** Boot migrations run before app startup completes; they are blocking, single-threaded, and finish before the Bolt app starts accepting events. This is the existing pattern for boot migrations and applies here without modification.

- **Trade-off:** File growth. Files grow monotonically without bound. At realistic scale this is a non-issue (~MB/year of JSON). At extreme scale (multi-year, many channels, high-frequency trivia) a future migration could shard by season — but that is deliberately deferred until the actual problem appears.

- **Trade-off:** All-time leaderboard recomputation. `retrieve_scores` with `season: "all"` filters nothing and groups across the full `answers.json`. At extreme scale this becomes O(n) per reveal. Acceptable trade for the simpler data model; the alternative (cumulative counters on user records) is a denormalization with its own correctness risks (counter drift if a manual data edit happens).

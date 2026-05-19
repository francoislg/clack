## Context

This change layers data isolation on top of a partially-landed foundation that made trivia channels declarative via `config.trivia.games[]`. The foundation already gives us:

- `TriviaGame` config type with `{ name, channel, questionCron, revealCron, timezone }`.
- `parseTriviaGames` that validates entries at config load and drops invalid ones with logged warnings.
- `buildGameSpecs(games, seasonsEnabled): CronJobSpec[]` that translates the config array into plugin-managed cron jobs.
- `sdk.reconcileCronJobs("trivia", specs)` invoked by `triviaPlugin` on every load.
- Migration `019-trivia-games-migration` that converts legacy dispatcher-style `trivia` cron jobs into `config.trivia.games[]` entries (`legacy-<channel>` names).
- Deletion of the on-demand "fetch scheduled-run prompt" MCP tools — prompts are baked into `CronJobSpec.prompt` via `buildGameSpecs` instead.

What's still missing is the actual **isolation**: every per-game tool reads and writes from the workspace-global `data/plugins/trivia/{questions,answers,cheats,seasons}.json`, so the `main` game and a `sandbox` game would share the same corpus. This change closes that gap.

## Goals / Non-Goals

**Goals:**

- Per-game data isolation: questions, answers, cheats, and seasons are scoped to the game's directory.
- Backward compatible: a blocking migration moves all existing flat-file data into a single `initialgame` directory; no data loss.
- Game lifecycle stays config-driven (admin edits `config.trivia.games[]`); the change does NOT introduce `create_game`/`delete_game` MCP tools.
- `list_games` for discoverability (Claude can introspect available games via tool call rather than peeking at config).
- Channel→game inference for reactive (DM/mention) sessions, so users don't have to name a game explicitly.
- `enabled: false` flag as a soft-delete primitive (skipped on cron reconcile + write tools refuse + reads still work).
- Strong `name` validation: `^[a-z0-9-]+$`, 1–32 chars.

**Non-Goals:**

- Tool-driven game lifecycle (no `create_game`, `disable_game`, `delete_game`, or `enable_game` tools). Game lifecycle is admin-edits-config + plugin reconciles.
- Cross-game queries (no "search all games" escape hatch). The directory structure supports it cheaply if needed later.
- Per-game categories. Categories stay global (`data/plugins/trivia/categories.json`).
- Per-game users. `users.json` is global; `cheatAttempts` is workspace-cumulative.
- Renaming a game. Slugs are immutable; renaming via config edit creates a new game and orphans the old directory (operator's responsibility to migrate or `rm -rf`).
- Hard-deleting a game's data through tooling. Set `enabled: false` (soft) or remove the config entry + manually `rm -rf` the directory.
- Restoring the on-demand instruction-fetch MCP tools that the foundation deleted.

## Decisions

### Decision 1: Game lifecycle stays config-driven

**Choice:** Games are defined in `config.trivia.games[]` and edited by admins. No `create_game`/`disable_game`/etc. MCP tools.

**Alternative considered:** Tool-managed registry (the original proposal direction) with `games.json` and lifecycle tools.

**Rationale:**

- The foundation already established the config-driven pattern. Inverting it now would mean undoing work and splitting responsibility (`config.trivia.games[]` for cron reconcile + `games.json` for data isolation).
- Config-driven matches how the rest of Clack works (one `config.json`, admin-edited, plugin-reconciles).
- Removes the "two sources of truth" problem (`config.trivia.games[]` and a hypothetical `games.json` would drift).
- Cron reconcile already handles "new entry appears → cron jobs created; entry removed → cron jobs disappear." Extending this to "directory created on first write" gives the same UX without adding tools.
- The DX cost — admins editing JSON instead of calling tools — is acceptable because trivia setup is rare (per-channel one-time) and admins doing trivia setup already edit `config.json` for `trivia.seasons.enabled` etc.

### Decision 2: Per-game directory, not per-row tag

**Choice:** `data/plugins/trivia/games/<name>/{questions,answers,cheats,seasons}.json`.

**Alternative considered:** Tag every row with `game: <name>` and keep the flat-file layout.

**Rationale:** Same as the original proposal — structural isolation beats filter-based isolation. Forgetting a `where game = X` filter at a single call site silently leaks data; opening the wrong file is physically impossible.

### Decision 3: `game` is a required tool argument

**Choice:** Every per-game tool takes `game: z.string()` and validates it against `config.trivia.games[].name`.

**Alternative considered:** Ambient channel context via SDK extension.

**Rationale:** Explicit args don't require SDK changes. The schedule prompts already know their game (built by `buildGameSpecs`); they bake `"Game: <name>"` into the prompt text so Claude passes it on every tool call. Reactive sessions use `resolveGameFromChannel(channelId)` — Claude calls this once at the top of a reactive trivia flow and passes the resolved name to subsequent tool calls.

### Decision 4: Per-game seasons via lazy seeding

**Choice:** `games/<name>/seasons.json` is created lazily on first use. When any tool resolves `game = "X"` and finds no `seasons.json` in that game's directory while `trivia.seasons.enabled` is true, the plugin creates one with a starter season (slug `season-YYYY-MM`, `categories` copied from the global `categories.json`).

**Alternative considered:** Eager seeding at config-load time (iterate `config.trivia.games[]` and seed each).

**Rationale:**

- The config-driven model means new games appear when admins add config entries — not via a tool call we can hook into.
- Eager seeding at config-load would either (a) write files for games that don't yet have any activity (wasteful, surprising) or (b) require a separate "did I already seed this game?" check that adds boot-time complexity.
- Lazy seeding ties the bootstrap to the first actual use of the game, which is the moment we actually need the file to exist. It mirrors how Clack handles other "first write creates the file" patterns.
- The cost: a slightly more complex `loadSeasonsState` accessor that seeds if absent. Worth it.

### Decision 5: Channel→game inference for reactive sessions

**Choice:** A `resolveGameFromChannel(channelId)` helper that consults `config.trivia.games[].channel` and returns the matching `name` (or `null`). Used by reactive (DM/mention) sessions; not needed by scheduled runs because they get the game name from the spec.

**Alternative considered:** Always require Claude to ask the user "which game?" before any reactive trivia tool call.

**Rationale:** The user requirement was "the plugin should never surface the game / ID." Channel inference preserves that — Claude resolves silently from context. The `triviaCheckInstruction` tells Claude to call the helper before any trivia tool call in a reactive flow.

### Decision 6: `enabled: false` is the soft-delete primitive

**Choice:** Optional `enabled?: boolean` on `TriviaGame` (defaults to `true`). When `false`:
- `buildGameSpecs` skips the entry — no cron jobs for it.
- Write tools (`save_question`, `submit_answers`, `save_cheating`, `upsert_season`, `delete_season`) refuse with a structured "game is disabled" error.
- Read tools (`find_previous_questions`, `retrieve_scores`, `get_question_history`, `list_seasons`, `check_season_status`, `list_games`) succeed.
- `list_games` excludes disabled games by default; pass `includeDisabled: true` to surface them.

**Rationale:** Same as the original proposal's soft-delete decision. Preserves historical data; reverses cleanly by clearing the flag.

### Decision 7: Migration 019 extended with data-move + inheritance

**Choice:** Extend the pre-existing blocking migration `019-trivia-games-migration` to do two passes in order:

1. **Cron jobs → `config.trivia.games[]`** (existing 019 behavior, unchanged). Dispatcher-style trivia cron jobs are paired by channel into `legacy-<channel>` entries; source jobs deleted.
2. **Flat data → per-game directory** (new in this change). If `data/plugins/trivia/{questions,answers,cheats,seasons}.json` files exist AND no per-game files already exist under `games/<fallback>/`, move them into `games/<target>/`. The target name is chosen in this priority order:
   a. The first newly-created `legacy-<channel>` entry from step 1.
   b. The first pre-existing `config.trivia.games[]` entry (e.g. from prior runs).
   c. A fallback `initialgame` entry, auto-created with placeholder crons (`0 0 * * 0`) + `enabled: false`. The operator renames + enables.

Fresh deployments (no schedules, no flat data) write nothing. Idempotent.

**Why `enabled: false` on the fallback `initialgame` entry only:** the fallback is only created when there's no schedule to inherit from. Placeholder crons must still parse cleanly (so `parseTriviaGames` doesn't drop the entry), but `enabled: false` ensures the plugin's cron reconciler doesn't spawn jobs for the placeholder. Admins replace the placeholders + flip `enabled` when ready.

**Alternative considered:** Split the data-move into a separate migration 020. Done initially; rolled back because the migration ordering (019 then 020) meant 020 always saw a populated config and ended up creating an `initialgame` entry even when 019 had just created a `legacy-<channel>` for the same data. Merging them means single-channel pre-existing deployments end up with one game holding both the schedule and the data, instead of two redundant entries.

**Rationale:** One migration, one decision. Operators rarely think about "where did my legacy data go" — having it auto-land in their newly-created `legacy-<channel>` (matching the schedule's channel) is the most useful default. The fallback `initialgame` only appears when there's truly nothing else to inherit from.

### Decision 8: Name format `^[a-z0-9-]+$`, 1–32 chars

**Choice:** Tighten `parseTriviaGames`'s `name` validation: must match `^[a-z0-9-]+$`, length 1–32. Existing validation already rejects empty + duplicates.

**Rationale:** Filesystem-safe (becomes a directory name), no path-injection vectors, human-readable.

## Risks / Trade-offs

- **[Schedules break post-upgrade only when the fallback `initialgame` is the data target]** → migration 019's fallback sets `enabled: false` on the auto-created `initialgame` entry. Admins must edit config (set valid crons + flip the flag) before scheduled trivia resumes. Single-channel deployments with an existing dispatcher schedule don't hit this path — their data lands in `legacy-<channel>` which carries the real cron values from step 1. Mitigation: release notes explicitly call this out for the no-schedule-but-has-data case.
- **[Multi-channel legacy deployments concentrate data in the first channel's entry]** → Migration 019 creates one `legacy-<channel>` entry per dispatcher pair and lands the legacy data in the FIRST entry. Mitigation: operators with multi-channel pasts get a runbook step ("review and redistribute data under `data/plugins/trivia/games/<name>/` if you actually want it split").
- **[Lazy season seeding is per-game-per-first-tool-call]** → first tool call for a game pays a one-time seasons.json write cost. Imperceptible.
- **[Tool surface area grows by one (`list_games`) but shrinks by three (the deleted instruction tools)]** → net simplification.
- **[`enabled: false` games still occupy disk]** → soft-delete preserves data forever. Acceptable. Manual `rm -rf` is the escape hatch.
- **[Channel→game inference fails for DM channels and ad-hoc channels not in config]** → that's correct behavior (refuse with "no trivia game configured for this channel"). Mitigation: the `triviaCheckInstruction` documents this so Claude surfaces a clean error.

## Migration Plan

1. **Migration 019 extended**: existing cron→config behavior unchanged; data-move step added on top with the inheritance order above.
2. **Plugin tweaks**: `data.ts` adds `forGame(name)` accessor + `resolveGameFromChannel`. `index.ts` removes the plugin-load seasons bootstrap (now lazy per-game). Every tool file gains the `game` Zod arg + per-game I/O routing.
3. **Scheduled prompt updates**: `scheduledPrompts.ts` adds `{game}` placeholder; `buildGameSpecs` substitutes per spec.
4. **Operator runbook (release notes)**:
   - Migration 019 runs automatically. Single-channel deployments with an existing dispatcher schedule end up with a `legacy-<channel>` entry containing both the schedule and the legacy data — ready to use after a rename (and a directory move at `data/plugins/trivia/games/<name>/`).
   - Deployments with legacy data but no schedule get a fallback `initialgame` entry with `enabled: false`. To resume scheduled trivia, edit that entry: replace `channel`, `questionCron`, `revealCron`, `timezone`, and flip `enabled` to `true`.
   - Multi-channel deployments: review `config.trivia.games[]` after the migration. You'll see one `legacy-<channel>` per dispatcher pair, and all legacy data concentrated in the first entry's directory. Redistribute by moving files between `data/plugins/trivia/games/<name>/` directories if needed.

**Rollback strategy:** the data-move step is non-destructive in spirit — files are moved, not transformed. Manual rollback: move `games/<name>/{questions,answers,cheats,seasons}.json` back to the trivia root; remove `games/` directory; remove the corresponding entry from `config.trivia.games[]`; redeploy prior version.

## Open Questions

- Should `list_games` include question/answer counts? Useful for the Home Tab but adds I/O. **Default for v1: no counts.** Add later if needed.
- Should the channel-inference helper also handle multi-game-per-channel (one channel = multiple games)? **Default for v1: no.** Each channel has at most one game. If a channel has zero, reactive trivia refuses there.
- Should `parseTriviaGames` warn-and-drop an entry whose `enabled` is malformed (non-boolean)? **Default: yes**, consistent with the parser's existing warn-and-drop philosophy.

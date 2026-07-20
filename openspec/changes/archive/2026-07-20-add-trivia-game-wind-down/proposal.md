# Proposal: add-trivia-game-wind-down

## Why

A trivia game meant to run as a finite series (a themed event, a pilot, a bounded campaign) currently has no way to stop itself: the season-end rollover unconditionally creates a continuation season, so every game runs forever until an admin manually disables it. Admins want to declare up front "when this season's final reveal lands, wind the game down" and have Clack do it — no follow-up intervention, no forgotten game posting into a dead channel.

## What Changes

- New OPTIONAL game-tier config field `disableAfterRound?: boolean` on `TriviaGame` (NOT a `CascadeAxes` member — same class as `tagPlayers`/`tellMeMore`: no season/slot tier). Absent/`false` → today's behavior, byte-for-byte.
- **BREAKING (tool rename):** `start_new_season` → `end_season`. The tool's guaranteed action is closing the current season (`endedAt` stamp); what follows is server-resolved policy — promote a queued season, create a continuation, or (new) wind the game down. The old name described the conditional half and becomes actively misleading once "no successor" is a valid outcome. No alias is kept: tool names are not persisted in any state file, so the rename is prompt/test/doc-mechanical.
- New wind-down branch inside `end_season`: when the game's `disableAfterRound` is `true`, on a genuine (or `force`d) season close the tool skips the continuation season, writes `enabled: false` to the game's config entry, and returns `gameDisabled: true` in its result. The prompt stays flag-blind — the tool reads config itself; Claude only keys the finale tone off the result payload (series wrap vs. season handoff).
- **Seasonless branch of the SAME tool** (`trivia.seasons.enabled` is workspace-GLOBAL, so seasons cannot be a prerequisite for one game's wind-down — e.g. a one-shot prediction event in a workspace whose other games are seasonless): `end_season` branches internally on whether a season is active. Active season → the wind-down branch above. No active season → a seasonless branch guarded by flag set + board cleared (zero unrevealed posted questions; `force` bypasses only the board check), prompt-gated by a new report-only `compute_answers` payload field `windDown: { eligible: true }`. Same report → prompt-gate → self-verifying-tool pattern as `isLastFireOfSeason`; one prompt step covers both gates (`isLastFireOfSeason === true` OR `windDown.eligible === true`). Conceptually a one-shot IS a season — re-enabling it next year is just the next round. No second tool. Eligibility is deliberately NOT coupled to schedule-shape detection (punctual crons etc.) — "flag set + board cleared" is the round-done signal.
- The wind-down branch is idempotent: re-running `end_season` on an already-ended season + already-disabled game is a no-op success, preserving the whole-reveal replay contract. `end_season` drops its `requireWritableGame` gate in favor of a narrower guard so this replay path is reachable (the disable itself makes the game unwritable).
- `force: true` on a `disableAfterRound` game also disables it (deliberate: "end it now" means end it); the result's `gameDisabled: true` surfaces the side effect.
- Enforcement is two-layered and both layers already exist: the config write triggers the soft restart that drops the game's cron specs (eventual), and `requireWritableGame` on `post_questions`/`compute_answers` refuses any straggler fire (immediate). A coalesced-away restart degrades to a noisy failed cron run, never a rogue post.
- Surfacing: `upsert_game` accepts the field (omit-to-keep / null-to-clear), `list_games` reports it, the finale-tone topic instruction gains a series-wrap variant keyed off `gameDisabled`.
- Documented operational recipe: correcting a wound-down game is "re-enable → fix → disable by hand" (`upsert_game` is not writability-gated). The standing flag bounds the exposure: a re-enabled game re-disables at its next season close.

## Capabilities

### New Capabilities

- `trivia-game-wind-down`: the `disableAfterRound` game-tier flag, the shared `windDownGame` executor, `end_season`'s two branches into it (season wind-down; seasonless board-cleared wind-down), `force` interaction, result-payload contract (`gameDisabled`), and the re-enable-to-correct recipe.

### Modified Capabilities

- `trivia-seasons`: season-end rollover tool renamed `start_new_season` → `end_season` (trivia-check instruction scenario, teams-stamp trigger prose); the Season-finale reveal layout requirement's stale "rollover happens INSIDE `process_reveal_answers`" sentence is corrected to the current renderer-calls-`end_season` architecture and gains the series-wrap closer variant.
- `trivia-reveal-processor`: `compute_answers` gains the report-only `windDown: { eligible }` payload field (seasonless wind-down eligibility); Purpose-prose tool-name mentions follow the rename.
- `trivia-scheduled-prompts`: reveal prompt step 3 references `end_season`, gated on `isLastFireOfSeason === true` OR `windDown.eligible === true`; `requiredTools` SHALL-NOT lists name `mcp__trivia__end_season`; prompt gains the series-wrap finale-tone conditional.
- `trivia-managed-schedules`: reveal spec `requiredTools` SHALL-NOT list follows the rename.
- `trivia-games`: `TriviaGame` grows `disableAfterRound`; `upsert_game`/`list_games` surface it.

## Impact

- `src/plugins/trivia/tools/seasons/startNewSeason.ts` → renamed file + tool, wind-down branch, narrowed write-gate, config write via the existing `persistGameWrite` path.
- `src/plugins/trivia/core/configTypes.ts` + config parser (`core/configParsers/`): new optional boolean on `TriviaGame` (graceful, absent-tolerant).
- `src/plugins/trivia/tools/games/upsertGame.ts`, `listGames.ts`: field surfacing.
- `src/plugins/trivia/prompts/scheduledPrompts.ts` (+ tests regexing `start_new_season`, incl. the ordering test), `prompts/topicInstructions.ts` (`FINALE_TONE_CONTENT` conditional), management/admin instruction text, `CLAUDE.md` trivia section.
- Registration/label in `src/plugins/trivia/index.ts`.
- New `src/plugins/trivia/domain/windDown.ts` (shared executor, called from both `end_season` branches); `compute_answers` eligibility computation.
- `openspec/specs/trivia-reveal-processor/spec.md` Purpose prose mentions the old tool name — updated as plain text during implementation (the `windDown` payload field is a real requirement change and has a delta spec).
- No state migration: tool names are not persisted; the new config field is optional and absent everywhere today.

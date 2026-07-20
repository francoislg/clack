# trivia-game-wind-down

## ADDED Requirements

### Requirement: `disableAfterRound` game-tier flag

The `TriviaGame` config entry SHALL accept an OPTIONAL `disableAfterRound?: boolean` field. It is a game-lifecycle field, NOT a `CascadeAxes` member: it SHALL NOT appear in `CascadeAxes` or `AXIS_REGISTRY`, has no season/slot/workspace tier, and is never rolled by `get_ideas` or stamped on question records. The parser SHALL treat it gracefully: absent ≡ `false`; a malformed (non-boolean) value drops the FIELD with a parse issue while preserving the entry, consistent with the sibling optional booleans (`tagPlayers`, `scrollToTop`).

When absent or `false`, every observable behavior of the trivia plugin SHALL be byte-for-byte identical to the pre-change behavior.

The flag is STANDING, not one-shot: it survives wind-down, so a game that is later re-enabled and given a new season winds down again at that season's close.

#### Scenario: Absent flag preserves legacy behavior

- **GIVEN** a game entry with no `disableAfterRound` field
- **WHEN** the season's last reveal fires and `end_season` runs
- **THEN** the rollover creates/promotes a successor season exactly as today
- **AND** the game remains `enabled`

#### Scenario: Flag is not a cascade axis

- **WHEN** `CascadeAxes` and `AXIS_REGISTRY` are inspected
- **THEN** neither contains `disableAfterRound`
- **AND** `get_ideas` responses and stored question records never carry it

### Requirement: `end_season` tool (renamed from `start_new_season`)

The season-rollover MCP tool SHALL be named `end_season`. It SHALL branch internally on whether the game has an active season: with one, it closes it (this requirement); without one, it runs the seasonless wind-down branch (see "Seasonless branch of `end_season`"). With an active season, its guaranteed action is CLOSING it (stamping `endedAt`, including the `teamsStamp` behavior per `trivia-seasons`); what follows is server-resolved policy, in this order of precedence:

1. A queued future season exists → it is promoted (no new season created).
2. The game's `disableAfterRound` is `true` → NO successor season is created; the tool persists `enabled: false` onto the game's config entry (via the same config-write path `upsert_game` uses, inheriting the file-watcher/soft-restart behavior) and returns `gameDisabled: true`.
3. Otherwise → a continuation season is created (today's behavior).

The tool SHALL keep the existing structural last-fire guard: it re-derives `isLastFireOfSeason` from the game's own `revealCron`; when it is NOT the last fire and `force` is not `true`, it performs NO change and returns `{ requiresConfirmation: true }`. No alias for the old name SHALL be registered — tool names are not persisted in any state file.

The result payload SHALL carry `closedSlug`, `seasonClosed`, optional `newSeasonStarted`, and — on the wind-down branch — `gameDisabled: true`, so the reveal renderer can key the finale tone (series wrap vs. season handoff) off the result without any prompt-level knowledge of the flag. On the wind-down branch the result message SHALL include the correction recipe (see "Correction recipe is discoverable").

#### Scenario: Wind-down on the season's last fire

- **GIVEN** a game with `disableAfterRound: true` and no queued future season
- **WHEN** `end_season` runs on the season's genuine last fire
- **THEN** the current season gets `endedAt` stamped
- **AND** NO continuation season is created
- **AND** the game's config entry is persisted with `enabled: false`
- **AND** the result carries `gameDisabled: true` and `seasonClosed: true`

#### Scenario: Normal rollover unaffected

- **GIVEN** a game without `disableAfterRound` (or set `false`)
- **WHEN** `end_season` runs on the season's last fire
- **THEN** the continuation/promotion behavior is unchanged from `start_new_season`
- **AND** the result does NOT carry `gameDisabled`

#### Scenario: force also winds down

- **GIVEN** a game with `disableAfterRound: true` mid-season
- **WHEN** an admin calls `end_season` with `force: true`
- **THEN** the season is closed early AND the game is disabled
- **AND** the result carries `gameDisabled: true` so the side effect is surfaced

#### Scenario: force without the flag is a normal early rollover

- **GIVEN** a game WITHOUT `disableAfterRound` (absent or `false`) mid-season
- **WHEN** an admin calls `end_season` with `force: true`
- **THEN** the season is closed early and a successor season is created or promoted (today's behavior)
- **AND** the game remains `enabled` and the result does NOT carry `gameDisabled`

#### Scenario: Wind-down orders the disable after the season-state save

- **GIVEN** a season wind-down is executing
- **WHEN** the branch persists its mutations
- **THEN** the season's `endedAt` save completes BEFORE the config write that disables the game
- **AND** a crash between the two leaves a closed season on an enabled game (converged by "Crash between endedAt and disable converges")

### Requirement: Wind-down idempotency preserves the whole-reveal replay contract

`end_season` SHALL NOT use the blanket `requireWritableGame` gate. It SHALL validate via `requireGame` plus its own semantic guard:

- Game disabled AND `disableAfterRound` is `true` AND (when the game has a season timeline) the closing/latest season already carries `endedAt` → **no-op success** returning `{ seasonClosed: true, gameDisabled: true, alreadyWoundDown: true }` (the replayed-finale case, both branches).
- Game disabled in any other state → a structured "game is disabled" error (a disabled game's timeline is not mutable by stray calls).

This preserves the documented whole-reveal replay contract: a crash after the disable but before `submit_response` can re-run the reveal's `end_season` step and succeed. The season-level idempotency (never re-stamp `endedAt`, never duplicate a queued continuation) SHALL be retained unchanged.

#### Scenario: Replayed finale is a no-op success

- **GIVEN** a game wound down by a previous `end_season` call (disabled, season `endedAt` stamped, `disableAfterRound: true`)
- **WHEN** `end_season` is called again for that game
- **THEN** the tool returns success with `alreadyWoundDown: true`
- **AND** no file (config or seasons state) is modified

#### Scenario: Stray call on an unrelated disabled game errors

- **GIVEN** a game disabled by hand whose latest season has NO `endedAt` (or `disableAfterRound` is not `true`)
- **WHEN** `end_season` is called for that game
- **THEN** the tool returns a structured "game is disabled" error and mutates nothing

#### Scenario: Crash between endedAt and disable converges

- **GIVEN** a wind-down run crashed after saving `endedAt` but before writing `enabled: false`
- **WHEN** `end_season` is re-run for the game
- **THEN** the season-level idempotency skips the re-stamp
- **AND** the wind-down branch completes the disable
- **AND** the result carries `gameDisabled: true`

### Requirement: Single wind-down executor behind both branches

The wind-down (guards, the `enabled: false` persist via the `upsert_game` config-write path, the recipe-bearing result message, and the `alreadyWoundDown` idempotency) SHALL be implemented ONCE, in a shared executor (`windDownGame`), reached ONLY through `end_season`'s two internal branches:

1. **Active season** → the season wind-down branch (per "`end_season` tool"). The prompt stays flag-blind on this path.
2. **No active season** → the seasonless branch (below), prompt-gated by `compute_answers`' `windDown.eligible` report (per `trivia-reveal-processor`).

No second wind-down tool SHALL be registered, and no other code path SHALL write `enabled: false` as an automated consequence of game play.

#### Scenario: Both branches share guards and messaging

- **WHEN** a game is wound down via the season branch and another via the seasonless branch
- **THEN** both persist `enabled: false` through the same executor
- **AND** both results carry `gameDisabled: true` and the correction recipe

### Requirement: Seasonless branch of `end_season`

When `end_season` is called for a game with NO active season (seasons disabled workspace-wide, or the game's timeline is in a gap), it SHALL run the seasonless wind-down branch instead of the no-current-season early return, IF AND ONLY IF the game carries `disableAfterRound: true`. The branch re-derives, server-side:

1. The game carries `disableAfterRound: true`. Without it, the tool SHALL answer exactly as today (seasons-uninitialized error when no timeline exists; the "No current season to roll over" response in a gap).
2. NO future season is queued. A queued season means the game is between rounds, not over — the tool SHALL report this and refuse to wind down, and `force` SHALL NOT bypass this check.
3. The board is cleared: zero unrevealed posted questions remain. `force: true` bypasses ONLY this check (a deliberate manual "wind this game down now").

Eligibility SHALL NOT depend on schedule shape (no punctual/yearly-cron detection) — "flag set + board cleared" is the round-done signal for every cron shape. A deliberate consequence: a recurring seasonless game with the flag set winds down after its first board-clearing reveal; the flag's description SHALL document this. Conceptually a one-shot IS a season: re-enabling the game later and clearing a new board is simply its next round, and winds down again.

On success the branch delegates to the shared executor and returns `{ gameDisabled: true, ... }` with the correction recipe. Idempotency follows the executor: an already-wound-down game (disabled + `disableAfterRound: true`) → no-op success with `alreadyWoundDown: true`; a game disabled in any other state → structured "game is disabled" error.

#### Scenario: Seasonless one-shot winds down after its reveal

- **GIVEN** a seasonless game with `disableAfterRound: true` whose reveal just processed every posted question
- **WHEN** `end_season({ game })` is called
- **THEN** the game's config entry is persisted with `enabled: false`
- **AND** the result carries `gameDisabled: true`

#### Scenario: Mid-board call refuses

- **GIVEN** a seasonless game with `disableAfterRound: true` that still has unrevealed posted questions
- **WHEN** `end_season({ game })` is called without `force`
- **THEN** the tool refuses with a structured error and mutates nothing

#### Scenario: Seasonless force bypasses the board-cleared check

- **GIVEN** a seasonless game with `disableAfterRound: true` that still has unrevealed posted questions
- **WHEN** `end_season({ game, force: true })` is called
- **THEN** the game is disabled despite the unrevealed questions
- **AND** the result carries `gameDisabled: true`

#### Scenario: A queued future season blocks the seasonless wind-down

- **GIVEN** a game with `disableAfterRound: true` whose timeline is in a gap with a future season queued
- **WHEN** `end_season` is called, with or without `force`
- **THEN** the tool reports the queued season and refuses to wind down
- **AND** mutates nothing

#### Scenario: Seasonless game without the flag answers as today

- **GIVEN** a seasonless game without `disableAfterRound`
- **WHEN** `end_season({ game })` is called
- **THEN** the tool returns the existing "No current season to roll over" response
- **AND** mutates nothing

#### Scenario: Replay is a no-op success

- **GIVEN** a game already wound down via the seasonless branch
- **WHEN** `end_season` is called again for that game
- **THEN** it returns success with `alreadyWoundDown: true` and modifies no file

### Requirement: Two-layer enforcement of the disabled state

The wind-down SHALL rely on BOTH existing enforcement layers, and neither may be weakened:

1. **Eventual**: the config write triggers the trivia config watcher's soft restart, which re-reconciles cron jobs; `buildGameSpecs` skips disabled games, so the game's cron specs are dropped.
2. **Immediate**: `post_questions` and `compute_answers` remain `requireWritableGame`-gated, so a straggler fire from stale cron specs (e.g. a coalesced-away restart) fails with a structured error and posts NOTHING to the channel.

A dropped/coalesced restart SHALL therefore degrade to a noisy failed cron run, never a rogue trivia post.

#### Scenario: Straggler fire after coalesced restart posts nothing

- **GIVEN** a game was wound down but the soft restart was coalesced away, leaving its cron specs live
- **WHEN** the game's question cron fires
- **THEN** `post_questions` refuses with a "game is disabled" error
- **AND** no message is posted to the game's channel

### Requirement: Correction recipe is discoverable

Correcting a wound-down game (e.g. `override_answer`, `settle_question` after the finale) requires temporarily re-enabling it. The recipe — `upsert_game(enabled: true)` → run the correction → `upsert_game(enabled: false)` — SHALL be documented in the trivia management/admin instruction, stating explicitly that the final manual re-disable is load-bearing (no auto-re-disable fires for an already-ended season). The `end_season` wind-down result message SHALL also carry the recipe, so it is discoverable at the moment it becomes relevant.

#### Scenario: Wind-down result teaches the recipe

- **WHEN** `end_season` returns `gameDisabled: true`
- **THEN** the result message includes the re-enable → correct → re-disable recipe

#### Scenario: Management instruction documents the recipe

- **WHEN** the trivia management instruction is inspected
- **THEN** it documents `disableAfterRound` and the correction recipe, including the load-bearing manual re-disable

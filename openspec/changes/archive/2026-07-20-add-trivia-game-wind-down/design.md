# Design: add-trivia-game-wind-down

## Context

The season-end flow today (reveal fire, seasons enabled):

```
1. compute_answers            → seasonStatus { isLastFireOfSeason, mvp, … }  (REPORT-ONLY)
2. refresh_question_cards
3. IF isLastFireOfSeason:  start_new_season({ game })
     ├─ requireWritableGame                       (throws on enabled: false)
     ├─ structural last-fire re-derivation        (requiresConfirmation guard; force bypass)
     ├─ stamp endedAt on current season
     └─ applySeasonRollover: promote queued season OR create continuation
4. submit_response            (finale layout)
```

`enabled: false` on a `TriviaGame` is an existing, well-defined terminal state: `buildGameSpecs` skips the game (crons vanish on the next reconcile), `requireWritableGame` refuses the write-side tool family with `GameDisabledError`, reads stay open ("frozen archive"), and `resolveGameFromChannel` stops routing the channel. A trivia config write triggers `watchFile → requestSoftRestart`, which re-reconciles cron jobs. `restartAll` only clears timers and reloads registration — it does NOT cancel an in-flight Claude session, and the Bolt socket stays up, so a session that wrote config mid-fire still completes its `submit_response` normally.

What's missing is a way for a game to declare "don't renew me": the rollover unconditionally produces a successor season, so every game runs until an admin intervenes by hand.

## Goals / Non-Goals

**Goals:**

- An admin sets one game-tier flag; at the season's final reveal the game closes its season, posts a series-wrap finale, and disables itself — zero further intervention.
- Zero new prompt surface for the flag itself: the decision lives server-side in the tool; Claude only reads the outcome from the result payload.
- Preserve the whole-reveal replay contract (crash between disable and `submit_response` → replay works).
- Byte-for-byte legacy behavior when the flag is absent.

**Non-Goals:**

- No coupling of wind-down eligibility to schedule-shape detection (punctual/yearly cron heuristics) — "flag set + board cleared" is the round-done signal regardless of cron shape. (An earlier draft rejected the seasonless case outright as "a one-fire game is expressible as a one-fire season"; retracted in Decision 9 — `trivia.seasons.enabled` is workspace-global, so that answer forces seasons onto unrelated games.)
- No new `paused` state separate from `enabled` — the existing frozen-archive semantics are reused (see Decision 4).
- No auto-re-enable, no scheduled resurrection, no season "gap then resume" mechanics.
- No alias for the old tool name.

## Decisions

### 1. Rename `start_new_season` → `end_season`

The tool's only guaranteed effect is stamping `endedAt`; succession is conditional (queued-season promote / continuation create / — now — nothing). The old name describes the conditional half and becomes actively misleading once "no successor, game disabled" is a valid outcome. The tool's own prose already reaches for closing-words ("No current season to roll over", "ending a season early is irreversible"). Renaming makes prompt gating self-explaining ("on the last fire, call `end_season`") and aligns the admin `force` path's intent ("end this season now") with the name.

*Alternative considered:* keep the name, add the branch. Rejected — a `start_new_season` documented as "may start nothing and disable the game" is the kind of name that misleads the model precisely where prompt-gating matters. *Alternative:* keep old name as alias. Rejected — tool names are persisted nowhere, and two names for one tool in the toolbelt is worse than none.

### 2. The wind-down decision lives INSIDE `end_season`, reading config server-side

`end_season` resolves the successor policy itself:

```
end_season({ game, force? }):
  narrowed write-gate (Decision 3)
  last-fire re-derivation + requiresConfirmation guard   (unchanged)
  stamp endedAt                                          (unchanged, incl. teamsStamp)
  game.disableAfterRound === true ?
    ├─ YES → skip continuation
    │        persist enabled: false on the game's config entry
    │        return { seasonClosed: true, gameDisabled: true, closedSlug }
    └─ NO  → applySeasonRollover as today
             return { seasonClosed, newSeasonStarted?, closedSlug }
```

The prompt stays flag-blind: it already says "on the last fire, call the rollover tool"; the tool can't be forgotten, and the flag can't be hallucinated because Claude never handles it. The only prompt delta is tonal — the finale keys off `gameDisabled` in the result (series wrap: no next-season preview, chapter closes for good) vs. today's season handoff.

*Alternative considered:* a separate `disable_game` step in the prompt after rollover. Rejected — new prompt surface, forgettable, hallucinatable, and it splits one atomic policy decision across two tool calls.

### 3. Idempotent wind-down + narrowed write-gate (replay contract)

Problem: the disable makes the game unwritable, and `end_season` (like the rest of the write family) is `requireWritableGame`-gated — so a crash after the disable but before `submit_response` would make the replayed reveal die at its own step 3 with `GameDisabledError`, breaking the documented "whole-reveal replay path is safe" contract.

Resolution: `end_season` switches from `requireWritableGame` to `requireGame` plus its own semantic guard:

- Game disabled AND current/latest season already has `endedAt` AND `disableAfterRound` is true → **no-op success** (`{ seasonClosed: true, gameDisabled: true, alreadyWoundDown: true }`). This is the replayed-finale case.
- Game disabled otherwise → error, same message intent as `GameDisabledError` (a disabled game must not have its season timeline mutated by a stray call).

The disable is ordered LAST inside the tool (after `endedAt` + seasons-state save), so a crash mid-tool leaves a closed season on an enabled game — and the re-run re-enters the wind-down branch, finds `endedAt` already stamped (season-level idempotency, existing), and completes the disable. Every interleaving converges.

Note: `compute_answers` and `refresh_question_cards` remain `requireWritableGame`-gated. Their replay window closes earlier: the disable is the LAST mutation of the fire, so a crash before it leaves the game enabled (steps 1–2 replayable), and a crash after it means steps 1–2 already completed and only `end_season` + `submit_response` need re-running. The one theoretically unreachable interleaving — replaying step 1 after the disable landed — is a full-reveal re-run of an already-finished finale, which the admin recipe (Decision 5) covers.

### 4. Reuse `enabled: false`; no new `paused` state

The resurrection trap is real: re-enabling a wound-down game to run a correction (`override_answer`, `settle_question`, …) brings its crons back, on a game whose season is expired with no continuation, and nothing will auto-disable it again (the last fire already passed). A separate `paused`/scheduling-off state would keep correction tools open without touching scheduling.

Chosen anyway: reuse `enabled`. Rationale:

- The flag is STANDING, not one-shot: `disableAfterRound` stays `true` after wind-down, so a deliberately re-enabled game re-disables at its next season close — the runaway is bounded to the correction window, not forever. (A re-enabled game with no active season will surface errors rather than post questions, which is noisy but safe.)
- A `paused` state doubles the terminal-state surface: every `requireWritableGame` site, `buildGameSpecs`, `resolveGameFromChannel`, catch-up, and Home-Tab-adjacent surfaces would each need a which-flag decision. The cost is out of proportion to a rare correction-after-finale event.
- The operational recipe is documented instead (Decision 5).

### 5. Correction recipe is documented, not mechanized

Correcting a wound-down game: `upsert_game(enabled: true)` (upsert_game is not writability-gated) → run the correction tool(s) → `upsert_game(enabled: false)`. The management/admin instruction states this explicitly, including that the final manual re-disable is load-bearing (no auto-re-disable will fire). This goes in the `end_season` result's message on the wind-down branch too, so the recipe is discoverable at the moment it becomes relevant.

### 6. `force: true` also winds down — deliberately

An admin-initiated early rollover (`force: true`) on a `disableAfterRound` game ends the season AND disables the game. "End it now" means end it; suppressing the wind-down on the forced path would leave the game in the exact zombie state the flag exists to prevent (no season, live crons). The surprise (flag set weeks earlier) is mitigated by `gameDisabled: true` in the result, which the tool description calls out.

### 7. Enforcement is two-layered, and the second layer is load-bearing

The config write triggers the existing soft restart, which drops the game's cron specs (eventual). If that restart is coalesced away (`restartInProgress` → skip), stale specs survive until the next restart — and the next fire dies at `requireWritableGame` inside `post_questions`/`compute_answers`, posting nothing. A dropped restart therefore degrades to a noisy failed cron run, never a rogue trivia post. **This property must not be "fixed" later by weakening the write-gate on the posting tools.** Stated here so it survives as a spec requirement.

### 8. Config plumbing

- `TriviaGame.disableAfterRound?: boolean` — optional, graceful parser (absent-tolerant; absent ≡ `false`). NOT a `CascadeAxes` member (no registry entry, no parity-test involvement) — it's a game-lifecycle field in the `tagPlayers`/`tellMeMore` class, but simpler (game tier only, no workspace default: a workspace-wide "all games self-destruct" default has no use case).
- Write path: the tool persists `enabled: false` through the same config-write helper `upsert_game` uses (`persistGameWrite`), inheriting the watcher/soft-restart behavior for free.
- `upsert_game`: omit-to-keep / `null`-to-clear, consistent with every other optional game field. `list_games`: surfaced per-entry when set.

### 9. Seasonless branch of the SAME tool: one executor, one tool, two branches

`trivia.seasons.enabled` is workspace-GLOBAL. A seasonless workspace running a one-shot event (e.g. a yearly prediction pool: post N questions, lock at showtime, reveal on a fixed date) cannot reach the season-close path — and turning seasons on just for it would change the behavior of every other game in the workspace (season bootstrap, season-tagged records, leaderboard composition, finale layouts). So season-close cannot be the only trigger.

No second tool is introduced. `end_season` branches internally on whether a season is active; conceptually a one-shot IS a season ("round" and "season" name the same unit at different formality), so the name holds in both branches — re-enabling the event next year is just its next round. Both branches clone the pattern the seasons path already uses — **report → prompt-gate → self-verifying tool** (`isLastFireOfSeason`'s trust model):

```
                end_season({ game, force? })  — THE one tool
                     │
         active season for the game?
              ├─ YES → last-fire guard → endedAt → successor policy
              │        (promote / continue / wind down)   [Decisions 2/3/6]
              └─ NO  → seasonless guard: disableAfterRound set AND board
                       cleared (zero unrevealed posted questions;
                       force bypasses ONLY the board check)
                          │
                          ▼
                windDownGame(game)  — THE one executor
                (guards, persist enabled:false, recipe message,
                 alreadyWoundDown idempotency; Decisions 3/5/7 verbatim)
```

- `compute_answers` stays report-only (its hard-won contract) but gains the seasonless analog of `seasonStatus`: it emits `windDown: { eligible: true }` when (a) the game has no active season, (b) `disableAfterRound` is `true`, and (c) after this reveal zero unrevealed posted questions remain (the board is cleared).
- The prompt keeps ONE conditional step: call `end_season` when `seasonStatus.isLastFireOfSeason === true` OR `windDown.eligible === true`. The tool re-derives the applicable branch's conditions server-side — a hallucinated call on a mid-board seasonless game (or a mid-season game) refuses. On a seasonless game WITHOUT the flag, the no-current-season early return answers as today.
- Deliberate consequence: a recurring seasonless game with the flag set winds down after its first board-clearing reveal — which is what the flag says. Documented in the flag's description.

*Alternative considered:* a separate `wind_down_game` tool for the seasonless branch. Rejected — a second tool doubles the prompt-gating surface and the refusal matrix for no behavioral gain; folding into `end_season` makes "exactly one wind-down path" structural. *Alternative:* putting the disable inside `compute_answers`. Rejected — it is report-only by explicit spec (`trivia-reveal-processor` REMOVED the in-tool rollover for this reason); reintroducing a config mutation there re-couples what was deliberately split. *Alternative:* deriving eligibility from schedule shape (punctual yearly cron ⇒ one-shot). Rejected — fragile, and "board cleared + flag" already expresses the intent for every schedule shape.

## Risks / Trade-offs

- [Soft restart races the in-flight finale session] → Traced: `restartAll` clears timers and reloads registration only; the session's tool closures and the Bolt socket survive, and `submit_response` reads nothing the restart reloads. Benign-by-construction, but noted as an invariant the lifecycle must keep.
- [Replay of steps 1–2 after disable is unreachable without re-enable] → Accepted; ordering the disable last makes this interleaving require a full re-run of an already-completed finale, covered by the documented recipe.
- [Rename ripples through prompts/tests/docs] → Mechanical: tool file + registration/label, `PROCESS_REVEAL_INSTRUCTIONS`, the ~6 `scheduledPrompts.test.ts` assertions (incl. tool-chain ordering), `check_season_status` description cross-reference, management instruction, `CLAUDE.md`. No state migration (tool names not persisted).
- [Admin forgets the manual re-disable after a correction] → Bounded by the standing flag (next season close re-disables IF a season is ever started) and by the seasonless game erroring rather than posting; recipe text emphasizes the final step.
- [`force` wind-down surprises an admin who forgot the flag] → `gameDisabled: true` in the result + tool description warning.
- [Seasonless gate adds hallucination surface] → mitigated the same way as the last-fire gate: the payload (`windDown.eligible`) decides when Claude calls, and `end_season` re-derives the branch conditions server-side, so a spurious call is a refused no-op.
- [The two branches drift apart] → both funnel into the single `windDownGame` executor; guards, persistence, idempotency, and the recipe message live only there.

## Migration Plan

None needed: the field is optional and absent everywhere; tool names are not persisted in any state file. Deploy is an ordinary image update. Rollback: revert the code — an already-wound-down game stays `enabled: false` (desired even under rollback), its closed season stays closed.

## Open Questions

None — the three review items (replay contract, `force` semantics, standing-vs-one-shot flag) are resolved as Decisions 3, 6, and 4 respectively.

## Context

After `refactor-trivia-reveal-tools`, the reveal closes with `submit_response` posting the summary (verdict + WHY + voter breakdown) and the leaderboard `table` top-level. `finalRevealSummary` controls that summary's narrative: keep it top-level (today), drop it, or move it to a thread. It is the summary-side of what was originally one `revealType` axis; the card-side is `add-trivia-reveal-in-cards`. The two compose freely.

Key product decision (from exploration): the **leaderboard always posts top-level** in every mode — only the narrative moves. This keeps standings visible in the channel regardless of the chosen mode.

This is a game+workspace setting like `allTimeRow` — a reveal renders one way for the whole batch — so it uses a dedicated two-tier resolver, not the per-question `CascadeAxes` machinery.

## Goals / Non-Goals

**Goals:**
- One game-level (workspace-defaulted) switch for the summary narrative's presence/placement, defaulting to today.
- Leaderboard always visible top-level; finale always top-level.
- `in-thread` keeps the channel uncluttered while preserving full reveal detail one click away.

**Non-Goals:**
- Per-season/slot setting; `CascadeAxes` membership.
- Anything about per-card narrative (that is `add-trivia-reveal-in-cards`).
- A new delivery tool — `in-thread` reuses `submit_response`'s `thread_replies`.

## Decisions

### Decision 1: Dedicated game→workspace resolver (mirror allTimeRow)

Add `finalRevealSummary?: "yes" | "no" | "in-thread"` to `TriviaGame` + `TriviaConfig`, `DEFAULT_FINAL_REVEAL_SUMMARY = "yes"`, and `resolveFinalRevealSummary(game, workspace)` in `domain/finalRevealSummary.ts` — verbatim shape of `resolveAllTimeRow`. Wiring mirrors `allTimeRow` end to end.

### Decision 2: Leaderboard top-level always; axis governs only the narrative

In all three modes the closing `submit_response` posts the leaderboard `table` top-level. The verdict/WHY/voter-breakdown blocks are: present top-level (`"yes"`), omitted (`"no"`), or moved to `thread_replies` (`"in-thread"`). This is the central invariant; it means even `"no"` always yields a top-level standings message, so the reveal is never fully silent.

### Decision 3: `in-thread` reuses `submit_response.thread_replies`

The reveal cron is the scheduled trigger, where `submit_response`'s `thread_replies` (and `additional_messages`) are available. `in-thread` mode posts the primary message = leaderboard `table` + a localized "see the responses in thread!" `context` pointer, and the full narrative blocks as `thread_replies` (posted as a threaded reply under the primary). No new tool. *Alternative considered:* a separate `post_to` with a thread target — rejected; `thread_replies` is the purpose-built mechanism and keeps it a single `submit_response`.

### Decision 4: Season finale stays top-level in all modes

The finale (winners podium + gated all-time table) is the leaderboard surface in its special last-fire form, so it always posts top-level — even in `"in-thread"`, where the day's per-question verdicts still go to the thread but the finale + standings stay in the channel. `finalRevealSummary` and the finale compose rather than conflict.

### Decision 5: Resolve fresh at reveal, return in the payload

`compute_answers` resolves the axis at reveal time and returns it; not stamped. Matches `allTimeRow`. A mid-cycle change applies on the next reveal.

## Risks / Trade-offs

- **`in-thread` pointer without a thread reply (Claude forgets `thread_replies`)** → prompt-inspection test asserts the `in-thread` branch instructs both the pointer and the `thread_replies` payload; the pointer string is localized via `sdk.t()`.
- **`"no"` mistaken for "no leaderboard either"** → spec + tests assert the leaderboard is always top-level; only narrative is dropped.
- **Finale vs in-thread ambiguity** → Decision 4 + a dedicated scenario (finale top-level, day's verdicts in thread).

## Migration Plan

1. Type + default + fields + parser/validator + `resolveFinalRevealSummary` (mirror `allTimeRow`).
2. `compute_answers` returns the axis.
3. Three-mode branch in `PROCESS_REVEAL_INSTRUCTIONS`; add the localized "see in thread" pointer string (en+fr).
4. `upsert_game` / `set_workspace_config` accept it; `list_games` surfaces it.
5. Tests; **rollback:** revert commit, field optional/absent-default, no data migration.

## Open Questions

- Pointer wording — "💬 Full reveal in the thread 👇" vs "If you want to see the responses, see in thread!"? (Defer to i18n; keep it short, both locales.)
- Shares prompt/payload/trivia-games touch-points with `add-trivia-reveal-in-cards`; apply one change, sync, then the other to avoid delta collisions.

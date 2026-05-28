## Context

The reveal-rendering instructions in `src/plugins/trivia/prompts/scheduledPrompts.ts` already describe two leaderboard table shapes — a `3-row dual-totals` table (when seasons are active AND there is prior-season activity) and a `2-row` table (otherwise). When a single cron fire posts N questions and the season's format calls for a multi-question reveal, the prompt currently emits a `Round Summary` text section listing each player's `<correct>/<totalQuestions>`. The cumulative leaderboard table below it does NOT echo that round delta.

The data needed to render a per-round row is already in the `process_reveal_answers` tool result: `roundSummary.perPlayer: Array<{ userId, displayName, correct, answered, roundMvp? }>`. The reveal tool drops `roundSummary` entirely when any reveal entry's `revealResponses` is `"just-correctness"` or `"no"` — the bucketed counts would leak data the admin chose to suppress. The new row inherits that gate by construction (no data → no row).

## Goals / Non-Goals

**Goals:**

- A new `This Round` row in the leaderboard table when (a) `reveals.length > 1` AND (b) `roundSummary` is present in the payload.
- The row reuses the player columns of `Current Season` / `All Time` so column widths align (Slack tables reject mismatched row widths).
- The row is omitted in single-question reveals (`reveals.length === 1`), empty-reveal acknowledgements (`reveals.length === 0`), and multi-question reveals where any entry suppresses participation (`roundSummary` absent).

**Non-Goals:**

- No change to the existing `Round Summary` text section. It keeps shipping alongside the new row; the redundancy is intentional (mentions + 🏆 MVP prefix cannot fit in a table cell).
- No change to single-question reveal layout, the empty-reveal acknowledgement, the `process_reveal_answers` tool, its result type, or any persisted data.
- No weighted scoring — each `correct` count remains one point. "Points handed out" === sum of `correct` across `perPlayer`, displayed per player.
- No re-sorting of the player column order. Players appear in the existing leaderboard order; the `This Round` row reads counts via `userId` lookup into `roundSummary.perPlayer`.

## Decisions

### Decision 1: Gate on `roundSummary` presence, not on a separate "is this round" flag

`roundSummary` is already the canonical signal for "the per-player round delta is available." When ANY reveal entry is `"just-correctness"` or `"no"`, the reveal tool drops `roundSummary` entirely. Reusing that gate keeps a single source of truth — no risk of the row appearing in modes where the data is intentionally suppressed.

**Alternatives considered:** a separate "render This Round" flag in the result; computing the counts in the renderer from `voters.correct`. Rejected — the first duplicates state, the second would force Claude to aggregate across reveals in restricted modes where the input was deliberately stripped.

### Decision 2: 2-row table gains a label column when the new row is rendered

The existing 2-row table has no left-side label column (Row 1 = names, Row 2 = totals). Adding a `This Round` row forces a label column so the row label has somewhere to live. The resulting 3-row labeled shape mirrors the existing 3-row dual-totals layout (which already has a label column).

**Alternatives considered:**

- Skip the `This Round` row entirely in the 2-row table case. Rejected — that would hide the round delta precisely in the simpler workspaces (no seasons / no prior-season activity), where users would benefit most from at-a-glance scoring.
- Add a row of single-character `"·"` separator labels instead of a real label column. Rejected — visually noisier than just naming the rows.

### Decision 3: `"—"` em-dash for absent players, never `""`

Slack rejects table cells with empty `raw_text` (`invalid_blocks` error). The existing prompt already calls this out for the top-left corner. The same rule applies to per-cell entries for players who appear on the leaderboard but did not answer this round. Em-dash is more visually distinct from `"0"` than alternatives like `"–"` (en-dash) or `"."`.

**Alternatives considered:**

- Render `"0"` for absent players. Rejected — conflates "answered but scored nothing" (which is impossible for a multi-question round with `roundSummary` present, since the player is only in the leaderboard if they answered) with "didn't participate at all." The em-dash makes the distinction visible.
- Omit the player column entirely for absent players. Rejected — column set must match across rows, and the `Current Season` / `All Time` rows below still need that player's column.

### Decision 4: Medals only on cells with `correct > 0`

Top-4-by-count medals (`🥇 🥈 🥉 🎀`) apply ONLY to cells where `correct > 0`. A player with `correct === 0` this round gets the bare count, not a medal. Tiebreak ordering follows `roundSummary.perPlayer` array order (already pre-sorted by the reveal tool).

This is consistent with the prompt's overall medal posture (medals indicate top performers, not just leaderboard position). It also avoids the absurdity of awarding 🎀 for a 0-correct round to fill the fourth-place slot when only three players got anything right.

## Risks / Trade-offs

- **[Visual density]** A 4-row table on mobile Slack can wrap awkwardly when there are many player columns. → Mitigation: the table already filters to players with current-season activity, capping column count organically.
- **[Round Summary section duplication]** Both the `Round Summary` section block and the `This Round` table row carry per-player round counts. → Accepted trade-off — see Non-Goals; section adds mentions + MVP prefix the table cannot.
- **[Prompt-only change can regress]** Claude renders the table from prose instructions; a small wording change could nudge it off-spec. → Mitigation: test assertions pin the `This Round` label, gating language, em-dash rule, and medal-scope rule as literal strings (same pattern the file already uses for `3-ROW DUAL-TOTALS TABLE` / `2-ROW TABLE`).

## Migration Plan

None. No persisted data changes; no migration needed. The first multi-question reveal after the prompt update simply renders the new row. Single-question fires, channels that disable seasons, and admins who set `revealResponses` to `"just-correctness"` or `"no"` see no change.

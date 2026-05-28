## Why

After a multi-question trivia reveal, the per-fire scoreboard delta is buried in the Round Summary section block (one line per player). The cumulative leaderboard table — the most visually prominent artifact in the message — shows season totals and all-time totals but no at-a-glance "what just happened this round" row. Adding a `This Round` row to the table surfaces the round's scoring impact in the same visual rhythm as the existing totals rows.

## What Changes

- `PROCESS_REVEAL_INSTRUCTIONS` (in `src/plugins/trivia/prompts/scheduledPrompts.ts`) gains a new `This Round` row prepended above `Current Season` / `All Time` in the leaderboard table, gated to multi-question reveals (`reveals.length > 1`).
- The row is rendered ONLY when `roundSummary` is present in the payload — i.e., every reveal entry in the batch is `"yes"` mode. When `roundSummary` is absent (any entry is `"just-correctness"` or `"no"`), the row is omitted, mirroring the existing gate on the Round Summary text section.
- The `2-row table` shape (used when `seasonStatus` is absent or `seasonStatus.hasPriorSeasons === false`) gains a left-side label column so the new row's `This Round` label has somewhere to live; it becomes a `3-row table with labels` in the multi-question + `roundSummary`-present case.
- The `3-row dual-totals table` shape becomes a `4-row dual-totals table` under the same gate.
- Cell content: bare correct-answer count per player (`String(correct)`), with `"—"` em-dash for players who are on the leaderboard but did not appear in `roundSummary.perPlayer` this round. Empty `raw_text` cells are rejected by Slack with `invalid_blocks`, so the em-dash is mandatory.
- Medal prefixes (`🥇 🥈 🥉 🎀`) apply only to cells where `correct > 0`, top-4 ordered by `roundSummary.perPlayer` (already pre-sorted). Players with `correct === 0` get the bare count or em-dash and no medal.
- The existing Round Summary section block stays unchanged — the table row and the section block both ship. The redundancy is intentional: the section carries `<@USER>` mentions and the `🏆` round-MVP prefix, neither of which fit in a table cell.

## Capabilities

### New Capabilities

(none — this is a refinement of the existing reveal-prompt spec.)

### Modified Capabilities

- `trivia-scheduled-prompts`: the `reveals.length` branch requirement gains scenarios pinning the new `This Round` row to the multi-question + `roundSummary`-present branch, including row position, cell format, em-dash fallback, medal scope, and label-column structure for both table shapes.

## Impact

- **Code:** `src/plugins/trivia/prompts/scheduledPrompts.ts` — `PROCESS_REVEAL_INSTRUCTIONS` constant only. No tool, type, data, or migration changes.
- **Tests:** `src/plugins/trivia/prompts/scheduledPrompts.test.ts` — existing assertions at lines ~397–398 that look for the literal strings `3-ROW DUAL-TOTALS TABLE` / `2-ROW TABLE` will need adjustment, and new assertions for the `This Round` gating + format are added.
- **Runtime data:** none. `roundSummary.perPlayer[i].correct` already flows in the `process_reveal_answers` tool result.
- **User-facing behavior:** multi-question reveal messages gain one extra row in the leaderboard table. Single-question reveals and empty-reveals branches are unchanged.

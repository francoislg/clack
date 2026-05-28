## MODIFIED Requirements

### Requirement: Reveal prompt branches on reveals.length

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL explicitly branch on `reveals.length`:

- `reveals.length === 0`: render an empty-payload acknowledgement plus the cumulative leaderboard table.
- `reveals.length === 1`: SINGLE-QUESTION layout — full per-voter-bucket sections (`correct`, `incorrect`, `noAnswer`) plus reactions commentary plus the leaderboard. The `roundSummary` field is IGNORED.
- `reveals.length > 1`: MULTI-QUESTION layout — brief per-question verdicts plus a "Round Summary" section sourced from `roundSummary.perPlayer`. Trades verbose voter-bucket sections for an aggregate scoreboard. The cumulative leaderboard table SHALL ALSO carry a `This Round` row above `Current Season` / `All Time` whenever `roundSummary` is present in the payload (see "Reveal table renders This Round row in multi-question batches").

#### Scenario: Single-question branch describes the new voter buckets

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the returned text describes rendering `correct`, `incorrect`, and `noAnswer` sections (when present per the `revealResponses` mode)
- **AND** does NOT reference `fenceSitters` or `wildcards`
- **AND** describes the per-mode rendering branches for `"yes"`, `"just-correctness"`, and `"no"`

#### Scenario: Empty-reveals branch unchanged

- **WHEN** the prompt's empty-reveals branch is inspected
- **THEN** the behavior is unchanged from prior to this proposal — render the acknowledgement plus the cumulative leaderboard

#### Scenario: Single-question layout omits This Round row

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the prompt does NOT instruct Claude to render a `This Round` leaderboard row in that branch
- **AND** the existing 3-row dual-totals shape and 2-row no-label shape remain the only two table shapes referenced by the single-question branch

## ADDED Requirements

### Requirement: Reveal table renders This Round row in multi-question batches

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe a `This Round` leaderboard-table row that is rendered ABOVE the `Current Season` / `All Time` rows whenever BOTH conditions hold: (a) `reveals.length > 1`, AND (b) the `roundSummary` field is present in the `process_reveal_answers` payload. When either condition fails, the row SHALL be omitted and the existing table shapes ship unchanged.

The row SHALL be sourced from `roundSummary.perPlayer`, using the SAME player columns as the `Current Season` / `All Time` rows (column widths MUST match across all rows of a Slack `table` block):

- For each player column, look up the entry in `roundSummary.perPlayer` by `userId`.
- If the player is present, render `String(correct)`.
- If the player is absent from `perPlayer` (on the leaderboard but did not answer this round), render the literal em-dash `"—"`. The empty string `""` is NOT permitted — Slack rejects empty `raw_text` cells with `invalid_blocks`.

Medal prefixes (`"🥇 "`, `"🥈 "`, `"🥉 "`, `"🎀 "`) SHALL be applied ONLY to cells where `correct > 0`, ordered top-4 by the existing `roundSummary.perPlayer` array order (already pre-sorted by the reveal tool). Em-dash cells and `correct === 0` cells SHALL NOT receive medals. Fewer than 4 medal-eligible players → assign medals only for whichever top positions exist.

The label cell for the row SHALL contain the literal text `"This Round"`.

#### Scenario: Multi-question reveal with roundSummary present describes This Round row

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt's multi-question table description references a `This Round` row positioned above `Current Season`
- **AND** the row label is the literal string `"This Round"`
- **AND** the prompt instructs Claude to source the row values from `roundSummary.perPlayer[i].correct`
- **AND** the prompt instructs Claude to render `"—"` (em-dash) for players present on the leaderboard but absent from `roundSummary.perPlayer`
- **AND** the prompt instructs Claude to apply medal prefixes only to cells where `correct > 0`

#### Scenario: Multi-question reveal without roundSummary omits This Round row

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt explicitly states that the `This Round` row is rendered ONLY when `roundSummary` is present in the payload
- **AND** the prompt explicitly states that when any reveal entry's `revealResponses` is `"just-correctness"` or `"no"`, the `roundSummary` field is absent and the `This Round` row is omitted (same gate as the existing Round Summary section block)

#### Scenario: Empty cell uses em-dash, never empty string

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt instructs Claude to use `"—"` (Unicode em-dash) for absent players
- **AND** explicitly warns that empty `raw_text` cells are rejected by Slack with `invalid_blocks`

### Requirement: Multi-question table shapes accommodate the label column

When the `This Round` row is rendered, the `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe two updated table shapes that preserve a left-side label column:

- When `seasonStatus` is PRESENT and `seasonStatus.hasPriorSeasons` is `true` → 4-ROW DUAL-TOTALS TABLE: `(" "/names-header), ("This Round"/round-correct), ("Current Season"/season-correct), ("All Time"/all-time-correct)`.
- When `seasonStatus` is ABSENT or `seasonStatus.hasPriorSeasons` is `false` → 3-ROW LABELED TABLE: `(" "/names-header), ("This Round"/round-correct), ("All Time"/all-time-correct)`. The label column is NEW for this shape (the existing 2-row table has no label column).

When the `This Round` row is NOT rendered (single-question reveal, empty-reveal acknowledgement, or multi-question reveal with `roundSummary` absent), the existing `3-row dual-totals` / `2-row no-label` shapes SHALL ship unchanged.

`column_settings` SHALL still carry one `{ "align": "center" }` entry per column (label column + each player column).

#### Scenario: 4-row dual-totals shape is described under gating

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt describes a 4-ROW DUAL-TOTALS TABLE shape gated to multi-question reveals with `roundSummary` present and `seasonStatus.hasPriorSeasons === true`
- **AND** the row order is names header → This Round → Current Season → All Time
- **AND** the description still references medal application to the Current Season and All Time rows independently of the This Round row

#### Scenario: 3-row labeled shape replaces 2-row when This Round is rendered

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt describes a 3-ROW LABELED TABLE shape used when multi-question reveals fire with `roundSummary` present AND (`seasonStatus` is absent OR `seasonStatus.hasPriorSeasons === false`)
- **AND** the description explicitly notes this shape carries a left-side label column that the legacy 2-row shape lacked
- **AND** the row order is names header → This Round → All Time

#### Scenario: Existing 3-row dual-totals and 2-row shapes ship unchanged when This Round is omitted

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt's single-question branch still describes the legacy 3-row dual-totals shape (no This Round row) and the legacy 2-row shape (no label column, no This Round row)
- **AND** the prompt's multi-question branch with `roundSummary` absent falls back to those same legacy shapes

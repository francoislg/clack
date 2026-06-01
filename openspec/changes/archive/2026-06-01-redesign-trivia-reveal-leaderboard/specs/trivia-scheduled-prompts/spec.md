## MODIFIED Requirements

### Requirement: Reveal prompt branches on reveals.length

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL explicitly branch on `reveals.length`:

- `reveals.length === 0`: POST NOTHING — terminate the run with `submit_response({ skip_response: true })`. No acknowledgement and no leaderboard render when there is no batch to reveal; a silent skip is preferred over a "nothing to reveal" message.
- `reveals.length === 1`: SINGLE-QUESTION layout — full per-voter-bucket sections (`correct`, `incorrect`, `noAnswer`) plus reactions commentary plus the leaderboard. The `This Round` leaderboard row SHALL be rendered whenever `roundSummary` is present in the payload (single-question reveals produce `roundSummary` when every entry's `revealResponses === "yes"`), per "Reveal table leads with This Round".
- `reveals.length > 1`: MULTI-QUESTION layout — brief per-question verdicts plus a "Round Summary" section sourced from `roundSummary.perPlayer`. Trades verbose voter-bucket sections for an aggregate scoreboard. The leaderboard table SHALL carry the `This Round` row whenever `roundSummary` is present, per "Reveal table leads with This Round".

The `This Round` row's presence SHALL be gated solely on `roundSummary` presence — NOT on `reveals.length`. The same gate (`roundSummary` absent) that drops the Round Summary section block also drops the `This Round` row.

#### Scenario: Single-question branch describes the new voter buckets

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the returned text describes rendering `correct`, `incorrect`, and `noAnswer` sections (when present per the `revealResponses` mode)
- **AND** does NOT reference `fenceSitters` or `wildcards`
- **AND** describes the per-mode rendering branches for `"yes"`, `"just-correctness"`, and `"no"`

#### Scenario: Empty-reveals branch posts nothing

- **WHEN** the prompt's empty-reveals branch is inspected
- **THEN** it instructs Claude to POST NOTHING — terminate with `submit_response({ skip_response: true })`
- **AND** it does NOT instruct rendering an acknowledgement or the cumulative leaderboard

#### Scenario: Single-question layout renders This Round row when roundSummary present

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the prompt instructs Claude to render the `This Round` leaderboard row whenever `roundSummary` is present in the payload
- **AND** the prompt does NOT gate the `This Round` row on `reveals.length`

## REMOVED Requirements

### Requirement: Reveal table renders This Round row in multi-question batches

**Reason**: The `This Round` row is no longer gated on `reveals.length > 1`, no longer positioned below `Current Season` / `All Time`, and no longer medaled by array position. Replaced by "Reveal table leads with This Round" (placement + gating + sort) and "Dense-rank medal assignment across leaderboard rows" (medals).

**Migration**: See ADDED requirements "Reveal table leads with This Round" and "Dense-rank medal assignment across leaderboard rows" in this delta. The row is now rendered whenever `roundSummary` is present (any reveal count), placed at the TOP of the table, and drives the column sort.

### Requirement: Multi-question table shapes accommodate the label column

**Reason**: The fixed "4-row dual-totals" / "3-row labeled" shape catalog gated on `reveals.length` and `hasPriorSeasons` is replaced by an additive row model (rows are present or absent independently) owned by `trivia-seasons`.

**Migration**: See `trivia-seasons` → "Seasons leaderboard row composition (normal reveals)". The seasons-on table is now `This Round? / Current Season / All Time?`, and the seasons-off shapes are unchanged.

## ADDED Requirements

### Requirement: Reveal table leads with This Round

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe a `This Round` leaderboard-table row that is rendered as the FIRST data row (immediately below the names header, ABOVE `Current Season` / `All Time`) whenever `roundSummary` is present in the `process_reveal_answers` payload. The label cell SHALL contain the literal text `"This Round"`.

The row SHALL be sourced from `roundSummary.perPlayer`: for each player column, look up the entry by `userId`; render `String(correct)` when present, or the literal Unicode em-dash `"—"` when the player is on the leaderboard but absent from `roundSummary.perPlayer`. The empty string `""` SHALL NOT be used — Slack rejects empty `raw_text` cells with `invalid_blocks`.

The whole table's COLUMN ORDER SHALL be decided ONCE and shared by every row (the Slack `table` block requires uniform column widths; a player owns exactly one column across all rows):

1. When `roundSummary` is present, order columns by `roundSummary.perPlayer` order (already `correct`-descending), then append any remaining present players (on the leaderboard but absent from `perPlayer`) ordered by `currentSeasonCorrect` descending. Em-dash / absent-this-round players sort LAST.
2. When `roundSummary` is absent, order columns by `currentSeasonCorrect` descending (the existing leaderboard order).

The prompt SHALL instruct that every row (names header, This Round, Current Season, All Time) fills cells in that single shared column order, and SHALL explicitly forbid sorting any single row's cells independently. A consequence SHALL be stated: the leftmost column is the round leader, which need not be the season or all-time leader.

#### Scenario: This Round is the top data row and drives column order

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt positions the `This Round` row directly below the names header and above `Current Season`
- **AND** the prompt instructs Claude to decide the column order once, by `roundSummary.perPlayer` order, and reuse it for every row
- **AND** the prompt forbids sorting individual rows independently

#### Scenario: This Round gated on roundSummary, not reveals.length

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt states the `This Round` row renders whenever `roundSummary` is present, for both single- and multi-question reveals
- **AND** the prompt states the row is omitted when `roundSummary` is absent (any reveal entry's `revealResponses` is `"just-correctness"`, `"just-winners"`, or `"no"`)

#### Scenario: Absent-this-round player uses em-dash and sorts last

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt instructs Claude to render `"—"` for players present on the leaderboard but absent from `roundSummary.perPlayer`
- **AND** those players are ordered after all present-this-round players in the shared column order

#### Scenario: Columns stay aligned when a player is em-dash in one row but numbered in another

- **WHEN** a player did not answer this round (em-dash in `This Round`) but has a non-zero `Current Season` total
- **THEN** the prompt instructs that the player occupies the SAME single column across every row — `"—"` in the `This Round` cell and `String(currentSeasonCorrect)` in the `Current Season` cell — with no row re-sorted to move that player

#### Scenario: Absent roundSummary falls back to season-score column order

- **WHEN** `roundSummary` is absent (any reveal entry's `revealResponses` is `"just-correctness"`, `"just-winners"`, or `"no"`)
- **THEN** the prompt instructs Claude to order columns by `currentSeasonCorrect` descending
- **AND** the `This Round` row is omitted

### Requirement: Dense-rank medal assignment across leaderboard rows

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe a SINGLE medal-assignment rule applied independently to each medaled leaderboard row (`This Round`, `Current Season`, `All Time`) and reused by the season-finale podium and All-Time table (see `trivia-seasons`):

- Rank by DISTINCT value, descending: the 1st distinct value receives `"🥇 "`, the 2nd `"🥈 "`, the 3rd `"🥉 "`, the 4th `"🎀 "`.
- Every cell holding a given value receives that value's medal — ties SHARE a medal (e.g. two players at the top value both get `"🥇 "`).
- Cells with value `0`, em-dash cells, and absent players SHALL NEVER receive a medal — even to fill an otherwise-empty top-4 slot.
- Fewer than 4 distinct medal-eligible values → assign medals only for the distinct values that exist.
- Medals SHALL use the Unicode characters, NOT Slack shortcodes (`:first_place_medal:` / `:ribbon:` render as literal text inside `table` cells).

#### Scenario: Tie at the top shares gold

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt states that all players sharing the top value in a row receive `"🥇 "`
- **AND** the next distinct value receives `"🥈 "`

#### Scenario: Zero and em-dash never medal

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt states that `0`-value cells and em-dash cells receive no medal under any circumstance

#### Scenario: Fourth distinct value wears the ribbon

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt assigns `"🎀 "` to the 4th distinct value in a row
- **AND** assigns medals to only the distinct values that exist when there are fewer than four

### Requirement: Empty correct bucket renders expanded answer detail

When a reveal entry's `correct` bucket is empty (no player answered correctly), the `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL instruct Claude to replace misser-naming with an EXPANDED explanation of the correct answer — a "nobody got it — here's the full story" treatment that teaches the room about the answer, rather than listing who got it wrong.

This SHALL apply to every `revealResponses` mode that exposes whether anyone was correct:

- In `"yes"` and `"just-correctness"` modes (named buckets), the expanded detail SHALL stand in place of the INCORRECT name-listing section.
- In `"just-winners"` mode (counts only), the expanded detail SHALL accompany the existing anonymous "everyone got fooled / nobody nailed it" line; no misser names exist to list.

The expanded detail SHALL NOT name or imply any misser beyond what the mode already permits. The treatment is appropriate whether players tried and all missed or nobody answered at all (both leave `correct` empty).

#### Scenario: Named-bucket mode swaps misser list for answer detail

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected for the `"yes"` / `"just-correctness"` branches
- **THEN** the prompt instructs Claude, when `correct` is empty, to render an expanded explanation of the correct answer instead of an INCORRECT name section

#### Scenario: just-winners mode pairs the fooled line with detail

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected for the `"just-winners"` branch
- **THEN** the prompt instructs Claude, when `correct` is empty, to render the anonymous "everyone got fooled" line together with an expanded explanation of the answer
- **AND** the prompt names no misser

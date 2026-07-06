## MODIFIED Requirements

### Requirement: Reveal table leads with This Round

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe a `This Round` leaderboard-table row that is rendered as the FIRST data row (immediately below the names header, ABOVE `Current Season` / `All Time`) whenever `roundSummary.perPlayer` is non-empty. The `This Round` label cell SHALL be the configured language's value for that label, sourced from the trivia i18n dictionary when the prompt is built — NOT a fixed English literal. (See "Reveal leaderboard labels are localized via the trivia dictionary" for the full localization rule covering every row label.)

The row SHALL be sourced from `roundSummary.perPlayer`: for each player column, look up the entry by `userId`; render `String(correct)` when present, or the literal Unicode em-dash `"—"` when the player is on the leaderboard but absent from `roundSummary.perPlayer`. The empty string `""` SHALL NOT be used — Slack rejects empty `raw_text` cells with `invalid_blocks`.

The prompt SHALL instruct that when a player's `roundSummary.perPlayer` entry carries `perfectRound: true`, that player's `This Round` cell SHALL have a trailing `" ⭐"` (a single space then the Unicode star `⭐`) appended AFTER the medal-and-score content (e.g. `"🥇 3 ⭐"`). The star SHALL be appended only in the `This Round` row and only for entries whose `perfectRound` flag is set; the prompt SHALL NOT re-derive perfection from `correct`/`totalQuestions` itself. Cells rendered as the em-dash `"—"`, and cells for players without `perfectRound`, SHALL NOT carry the star. The star is orthogonal to the dense-rank medal — a perfect cell keeps its `🥇` medal and gains the trailing `⭐`.

The whole table's COLUMN ORDER SHALL be decided ONCE and shared by every row (the Slack `table` block requires uniform column widths; a player owns exactly one column across all rows):

1. When `roundSummary.perPlayer` is non-empty, order columns by `roundSummary.perPlayer` order (already `correct`-descending), then append any remaining present players (on the leaderboard but absent from `perPlayer`) ordered by `currentSeasonCorrect` descending. Em-dash / absent-this-round players sort LAST.
2. When `roundSummary.perPlayer` is empty, order columns by `currentSeasonCorrect` descending (the existing leaderboard order).

The prompt SHALL instruct that every row (names header, This Round, Current Season, All Time) fills cells in that single shared column order, and SHALL explicitly forbid sorting any single row's cells independently. A consequence SHALL be stated: the leftmost column is the round leader, which need not be the season or all-time leader.

#### Scenario: This Round is the top data row and drives column order

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt positions the `This Round` row directly below the names header and above `Current Season`
- **AND** the prompt instructs Claude to decide the column order once, by `roundSummary.perPlayer` order, and reuse it for every row
- **AND** the prompt forbids sorting individual rows independently

#### Scenario: This Round gated on non-empty perPlayer, not reveals.length or mode

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt states the `This Round` row renders whenever `roundSummary.perPlayer` is non-empty, for both single- and multi-question reveals and ANY reveal mode
- **AND** the prompt states the row is omitted only when `perPlayer` is empty (nobody answered this round)
- **AND** the prompt states the reveal mode (`revealResponses`) NEVER affects this row

#### Scenario: Absent-this-round player uses em-dash and sorts last

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt instructs Claude to render `"—"` for players present on the leaderboard but absent from `roundSummary.perPlayer`
- **AND** those players are ordered after all present-this-round players in the shared column order

#### Scenario: Columns stay aligned when a player is em-dash in one row but numbered in another

- **WHEN** a player did not answer this round (em-dash in `This Round`) but has a non-zero `Current Season` total
- **THEN** the prompt instructs that the player occupies the SAME single column across every row — `"—"` in the `This Round` cell and `String(currentSeasonCorrect)` in the `Current Season` cell — with no row re-sorted to move that player

#### Scenario: Empty perPlayer falls back to season-score column order

- **WHEN** `roundSummary.perPlayer` is empty (nobody answered this round)
- **THEN** the prompt instructs Claude to order columns by `currentSeasonCorrect` descending
- **AND** the `This Round` row is omitted

#### Scenario: Perfect-round player's This Round cell carries a trailing star

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt instructs Claude to append `" ⭐"` after the medal-and-score content of a `This Round` cell whenever that player's `roundSummary.perPlayer` entry carries `perfectRound: true` (e.g. `"🥇 3 ⭐"`)
- **AND** the prompt states the star is appended only in the `This Round` row, only for `perfectRound` entries, and never on em-dash cells or players without the flag
- **AND** the prompt instructs Claude to read the flag from the payload rather than re-deriving perfection from `correct`/`totalQuestions`

#### Scenario: A worked example shows the star alongside the medal

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** at least one leaderboard-table example renders a `This Round` cell combining a dense-rank medal and the trailing star (e.g. `"🥇 3 ⭐"`) for a perfect-round player

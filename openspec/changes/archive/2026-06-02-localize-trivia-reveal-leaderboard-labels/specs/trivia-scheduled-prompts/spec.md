## ADDED Requirements

### Requirement: Reveal leaderboard labels are localized via the trivia dictionary

The reveal prompt SHALL be constructed with its leaderboard structural label tokens already rendered in the configured language, sourced from the trivia i18n dictionary (`sdk.t()` / the registered `en`/`fr` tables), NOT emitted as fixed English literals for Claude to translate. This applies to every leaderboard row-label cell the prompt dictates: `This Round`, `Current Season`, `All Time`, and the seasons-off totals labels. Because the built prompt already carries the configured language's label, Claude copies the dictated token verbatim into the Slack `table` cell — the same verbatim-copy behavior that previously leaked English now delivers the localized label.

The reveal prompt SHALL therefore be produced by a builder function (evaluated at cron-reconcile time, after the plugin translator is wired) rather than being a fixed string constant for the localized portions, so its labels resolve against the configured language via the plugin translator (the same `sdk.t` surface, accessed through the plugin's module-level `t`). The worked table examples embedded in the prompt SHALL render their label cells from the same dictionary as the instruction text, so a non-English workspace's examples show the localized labels and Claude cannot anchor on English example cells.

The medal glyphs (`🥇`/`🥈`/`🥉`/`🎀`), the `String(...)` numeric value cells, the em-dash `"—"`, the single-space names-header label `" "`, and player `displayName` cells are language-neutral and SHALL NOT be routed through the dictionary. Free prose around the table (closers, transitions, per-question verdicts) continues to rely on the LANGUAGE directive.

When the configured language is English the dictionary values equal the prior literals (`This Round`, `Current Season`, `All Time`), so the built prompt and resulting output are byte-identical to the pre-change behavior.

#### Scenario: Built reveal prompt carries localized labels in a French workspace

- **GIVEN** the configured language is French
- **WHEN** the reveal prompt is built
- **THEN** the leaderboard row-label tokens in the prompt are the French dictionary values (e.g. `Saison en cours`, `Cumulatif`) rather than English literals
- **AND** the worked table examples in the prompt use those same French label cells
- **AND** the medal glyphs, numeric value cells, and em-dash cells remain unchanged

#### Scenario: English workspace prompt and output are byte-stable

- **GIVEN** the configured language is English
- **WHEN** the reveal prompt is built
- **THEN** the leaderboard row labels resolve to `This Round`, `Current Season`, and `All Time` exactly as before the change

## MODIFIED Requirements

### Requirement: Reveal table leads with This Round

The `PROCESS_REVEAL_INSTRUCTIONS` reveal prompt SHALL describe a `This Round` leaderboard-table row that is rendered as the FIRST data row (immediately below the names header, ABOVE `Current Season` / `All Time`) whenever `roundSummary` is present in the `process_reveal_answers` payload. The `This Round` label cell SHALL be the configured language's value for that label, sourced from the trivia i18n dictionary when the prompt is built — NOT a fixed English literal. (See "Reveal leaderboard labels are localized via the trivia dictionary" for the full localization rule covering every row label.)

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

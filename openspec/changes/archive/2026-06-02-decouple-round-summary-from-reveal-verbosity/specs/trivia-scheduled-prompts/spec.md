## MODIFIED Requirements

### Requirement: Answer-reveal prompt step flow

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL open with the Game Show Presenter persona directive and a "Game: {game}" header, then direct Claude through a renderer flow consisting of exactly two steps:

1. **Call `process_reveal_answers(game: "{game}")`** and read its returned payload. The prompt SHALL describe the payload's shape (the `reveals[]`, `leaderboard`, `roundSummary`, and optional `seasonStatus` fields) so Claude can render it without inventing structure. The prompt SHALL describe each reveal entry's `voters` as a discriminated union on `voters.revealResponses` with three variants:
   - `"yes"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters in `correct[]` and `incorrect[]` carry an `answerText` field that SHOULD be quoted in the reveal.
   - `"just-correctness"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters DO NOT carry `answerText`. The prompt SHALL instruct Claude to enumerate the named voters (e.g. "Marc and Sarah nailed it; Bob missed it") but SHALL NOT quote any typed freeform text — and SHALL note that the text is not in the payload to quote.
   - `"no"` → `voters` carries ONLY `reactions`. The `correct`, `incorrect`, and `noAnswer` fields are physically absent. The prompt SHALL instruct Claude to render the answer plus reactions commentary plus the leaderboard, and NOT to invent or speculate about who voted what.

   The prompt SHALL describe `voters.reactions` as carrying every reactor's FULL emoji set, with bot + cheaters already excluded. The prompt SHALL describe `roundSummary` as ALWAYS present and INDEPENDENT of `revealResponses` (it is the per-player scoreboard aggregate, not a per-question display) — its `perPlayer` array is empty only when nobody answered this round.

2. **Render the payload via `submit_response`** using the Game Show Presenter voice and Block Kit conventions:
   - A `header` block announcing the verdict (e.g. "🎯 THE ANSWER IS TRUE!", "🎲 IT'S FALSE!", or the equivalent for choice; for freeform, the canonical `expectedAnswer`).
   - A `section` block explaining WHY using the question's facts.
   - A `divider` block.
   - For `revealResponses === "yes"`: one `section` block per non-empty voter situation: `correct`, `incorrect`, `noAnswer`. Empty situations SHALL be omitted. Quote freeform `answerText` inline when present.
   - For `revealResponses === "just-correctness"`: one `section` block per non-empty voter situation: `correct`, `incorrect`, `noAnswer`. Empty situations SHALL be omitted. Enumerate named voters WITHOUT quoting any freeform text.
   - For `revealResponses === "no"`: NO voter-situation sections. Skip directly to the reactions / closer / leaderboard.
   - A `section` block for `reactions` commentary — Claude SHALL freely riff on each reactor's emoji set, treating reactions as pure flavor. For `"yes"` and `"just-correctness"` modes, Claude MAY join on `userId` to correlate reactions with each user's answer when interesting (e.g. "Marc clutched the right answer AND dropped a 🎯"). For `"no"` mode, Claude SHALL NOT correlate reactions with answers (the per-user answer data is not in the payload).
   - A `context` block as a closer that introduces the leaderboard.
   - A top-level `table` parameter rendering the leaderboard.

The prompt SHALL explicitly state that scoring is NOT derived from Slack reactions — the `correct` / `incorrect` buckets are the source of truth (when present) and reactions are commentary only. The prompt SHALL NOT instruct Claude to interpret reactions as votes, classify "fence-sitters" by counting `:+1:` + `:-1:`, or void "multi-react voters" on choice questions.

The prompt SHALL explicitly state that Claude SHALL NOT invent or speculate about per-user participation when the `voters` variant does not include those buckets (`"no"` mode) — the payload boundary is the gate.

#### Scenario: Reveal prompt describes the discriminated voter shape

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the text describes `voters.revealResponses` as the discriminator and enumerates all three variants (`"yes"`, `"just-correctness"`, `"no"`)
- **AND** the `"yes"` variant description mentions `correct`, `incorrect`, `noAnswer`, `reactions` AND freeform `answerText` quoting
- **AND** the `"just-correctness"` variant description mentions `correct`, `incorrect`, `noAnswer`, `reactions` AND explicitly states freeform text MUST NOT be quoted (and is not in the payload)
- **AND** the `"no"` variant description states ONLY `reactions` is present and instructs Claude not to speculate about per-user participation
- **AND** does NOT mention `voters.fenceSitters` or `voters.wildcards`
- **AND** does NOT describe a "user reacted with both 👍 and 👎" fence-sitter classification
- **AND** does NOT describe a "multi-react void" rule

#### Scenario: Reveal prompt branches block rendering on revealResponses

- **WHEN** the prompt's per-mode rendering instructions are inspected
- **THEN** the `"yes"` branch describes per-bucket sections WITH freeform quotes
- **AND** the `"just-correctness"` branch describes per-bucket sections WITHOUT freeform quotes
- **AND** the `"no"` branch describes NO per-bucket sections, only reactions + closer + leaderboard

#### Scenario: Reveal prompt describes roundSummary as always present and mode-independent

- **WHEN** the prompt's payload-shape description is inspected
- **THEN** `roundSummary` is described as ALWAYS present and INDEPENDENT of `revealResponses`
- **AND** the prompt states `roundSummary.perPlayer` is empty only when nobody answered this round

#### Scenario: Reveal prompt treats reactions as commentary

- **WHEN** the prompt's reactions section is inspected
- **THEN** the text instructs Claude to riff on per-user emoji sets purely for flavor
- **AND** explicitly states that reactions do not affect scoring
- **AND** invites Claude to correlate reactions with the same user's answer when there is something funny to say (correct + 🎯, incorrect + 🤔, no-answer + 🐢, etc.)

#### Scenario: Reveal prompt omits submit_answers

- **WHEN** the prompt is inspected
- **THEN** the text does NOT reference a `submit_answers` tool call
- **AND** the only deterministic-work tool referenced is `process_reveal_answers`

### Requirement: Reveal prompt branches on reveals.length

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL explicitly branch on `reveals.length`:

- `reveals.length === 0`: POST NOTHING — terminate the run with `submit_response({ skip_response: true })`. No acknowledgement and no leaderboard render when there is no batch to reveal; a silent skip is preferred over a "nothing to reveal" message.
- `reveals.length === 1`: SINGLE-QUESTION layout — full per-voter-bucket sections (`correct`, `incorrect`, `noAnswer`) plus reactions commentary plus the leaderboard. The `This Round` leaderboard row SHALL be rendered whenever `roundSummary.perPlayer` is non-empty, per "Reveal table leads with This Round".
- `reveals.length > 1`: MULTI-QUESTION layout — brief per-question verdicts plus a "Round Summary" section sourced from `roundSummary.perPlayer`. Trades verbose voter-bucket sections for an aggregate scoreboard. The leaderboard table SHALL carry the `This Round` row whenever `roundSummary.perPlayer` is non-empty, per "Reveal table leads with This Round".

The `This Round` row's presence SHALL be gated solely on `roundSummary.perPlayer` being non-empty — NOT on `reveals.length` and NOT on any entry's `revealResponses` mode. The same gate (empty `perPlayer`) that drops the Round Summary section block also drops the `This Round` row.

#### Scenario: Single-question branch describes the new voter buckets

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the returned text describes rendering `correct`, `incorrect`, and `noAnswer` sections (when present per the `revealResponses` mode)
- **AND** does NOT reference `fenceSitters` or `wildcards`
- **AND** describes the per-mode rendering branches for `"yes"`, `"just-correctness"`, and `"no"`

#### Scenario: Empty-reveals branch posts nothing

- **WHEN** the prompt's empty-reveals branch is inspected
- **THEN** it instructs Claude to POST NOTHING — terminate with `submit_response({ skip_response: true })`
- **AND** it does NOT instruct rendering an acknowledgement or the cumulative leaderboard

#### Scenario: Single-question layout renders This Round row when perPlayer non-empty

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the prompt instructs Claude to render the `This Round` leaderboard row whenever `roundSummary.perPlayer` is non-empty
- **AND** the prompt does NOT gate the `This Round` row on `reveals.length` or on the reveal mode

### Requirement: Reveal table leads with This Round

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe a `This Round` leaderboard-table row that is rendered as the FIRST data row (immediately below the names header, ABOVE `Current Season` / `All Time`) whenever `roundSummary.perPlayer` is non-empty. The `This Round` label cell SHALL be the configured language's value for that label, sourced from the trivia i18n dictionary when the prompt is built — NOT a fixed English literal. (See "Reveal leaderboard labels are localized via the trivia dictionary" for the full localization rule covering every row label.)

The row SHALL be sourced from `roundSummary.perPlayer`: for each player column, look up the entry by `userId`; render `String(correct)` when present, or the literal Unicode em-dash `"—"` when the player is on the leaderboard but absent from `roundSummary.perPlayer`. The empty string `""` SHALL NOT be used — Slack rejects empty `raw_text` cells with `invalid_blocks`.

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

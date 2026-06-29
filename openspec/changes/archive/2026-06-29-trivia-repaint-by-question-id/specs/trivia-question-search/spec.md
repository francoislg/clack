## ADDED Requirements

### Requirement: find_previous_questions exposes derived batch facts, never the batchId

For each **posted** row it returns (a row with a `postedAt` and a `batchId`), `find_previous_questions` SHALL include two derived boolean fields computed within that row's own game:

- `batchPending` — `true` when no question sharing the row's `batchId` carries a `processedAt` timestamp (the batch is unrevealed: still live, votes open); `false` once any sibling has a `processedAt` timestamp.
- `batchIsLatest` — `true` when the row's `batchId` is the game's most-recently-posted batch (the batch whose maximum `postedAt` is greatest among that game's batched rows). In the rare case two batches share the same greatest maximum `postedAt`, every row of each tied batch is marked `batchIsLatest: true`.

These facts let an admin reason about replay eligibility, top-up, and "fix the last batch" without handling the opaque grouping key. The tool SHALL NOT include the raw `batchId` in any returned row. Rows that are unposted or carry no `batchId` (legacy/staged) SHALL omit both fields.

#### Scenario: A live latest batch reports pending and latest

- **GIVEN** game `main` whose most recent batch `["Q1", "Q2"]` (shared `batchId`) has no `processedAt` on any member
- **WHEN** `find_previous_questions` returns `Q1`
- **THEN** `Q1` carries `batchPending: true` and `batchIsLatest: true`
- **AND** `Q1` does not carry a `batchId` field

#### Scenario: An older revealed batch reports neither pending nor latest

- **GIVEN** an earlier batch `["Q0"]` that has been revealed (`processedAt` set) and a newer pending batch exists
- **WHEN** `find_previous_questions` returns `Q0`
- **THEN** `Q0` carries `batchPending: false` and `batchIsLatest: false`

#### Scenario: Facts are computed per game in a cross-game scan

- **GIVEN** `find_previous_questions` scans game `main` (batch `M1` at `postedAt: 100`, batch `M2` at `postedAt: 200`) and game `side` (batch `S1` at `postedAt: 150`)
- **WHEN** rows from both games are returned
- **THEN** the `main` rows carry `batchIsLatest: true` for `M2` and `false` for `M1`
- **AND** the `side` row for `S1` carries `batchIsLatest: true` (its game's latest, regardless of `main`'s higher `postedAt`)

#### Scenario: A staged (unposted) row omits the batch facts

- **GIVEN** a generated-but-unposted question with no `batchId`
- **WHEN** `find_previous_questions` returns it (via `posted: false`)
- **THEN** the row carries neither `batchPending` nor `batchIsLatest`

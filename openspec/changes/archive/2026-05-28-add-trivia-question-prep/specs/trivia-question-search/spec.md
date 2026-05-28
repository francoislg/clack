## ADDED Requirements

### Requirement: find_previous_questions supports filtering by posted state

The `find_previous_questions` MCP tool SHALL accept an optional `posted?: boolean` argument. When supplied, the value SHALL participate in the existing `match: "all" | "any"` top-level combinator as an additional criterion, governed by the same semantics as the other criteria.

- `posted: true` — a row matches this criterion iff `q.postedAt !== undefined`.
- `posted: false` — a row matches this criterion iff `q.postedAt === undefined` (the "staged" state).
- `posted` omitted — the criterion is not supplied and SHALL NOT participate in the combinator.

The tool's description SHALL document this third use case (staged-pool query) alongside the existing duplicate-detection and recent-batch-lookup use cases.

#### Scenario: posted: true returns only posted questions

- **GIVEN** a game's `questions.json` contains 5 questions where 3 have `postedAt` defined and 2 do not
- **WHEN** `find_previous_questions({ games: ["<game>"], posted: true, match: "all" })` is called
- **THEN** the returned questions are exactly the 3 posted questions

#### Scenario: posted: false returns only staged questions

- **GIVEN** a game's `questions.json` contains 5 questions where 3 have `postedAt` defined and 2 do not
- **WHEN** `find_previous_questions({ games: ["<game>"], posted: false, match: "all" })` is called
- **THEN** the returned questions are exactly the 2 unposted (staged) questions

#### Scenario: posted omitted returns all questions

- **GIVEN** a game's `questions.json` contains 5 questions in mixed posted/staged state
- **WHEN** `find_previous_questions({ games: ["<game>"], match: "all" })` is called (no `posted`)
- **THEN** the returned questions are all 5 (criterion not supplied; behavior unchanged from pre-change)

#### Scenario: posted combines with other criteria under match: "all"

- **GIVEN** the staged pool contains 3 staged questions for game `main` (one each for slots 0, 1, 2 of the current season) and 1 staged question for game `other`
- **WHEN** `find_previous_questions({ games: ["main"], seasons: ["current"], posted: false, match: "all" })` is called
- **THEN** the returned rows are exactly the 3 staged questions belonging to game `main` in the current season

#### Scenario: posted combines with other criteria under match: "any"

- **GIVEN** a question pool contains posted and staged questions across multiple games
- **WHEN** `find_previous_questions({ games: ["main"], posted: false, match: "any" })` is called
- **THEN** the returned rows are the union of (questions in game `main`) ∪ (questions with `postedAt` undefined)

### Requirement: posted: false rejects combination with recentBatchFromNow

The `find_previous_questions` MCP tool SHALL reject calls that combine `posted: false` with `recentBatchFromNow`. Because `recentBatchFromNow` internally requires `postedAt !== undefined && batchId !== undefined`, the combination would always return an empty set — likely a caller error. The tool SHALL return a structured error with a clear message naming both arguments.

The combination of `posted: true` (or omitted) with `recentBatchFromNow` SHALL remain permitted and SHALL behave as today.

#### Scenario: posted: false plus recentBatchFromNow rejected

- **GIVEN** a caller invokes `find_previous_questions({ games: ["main"], posted: false, recentBatchFromNow: 1 })`
- **WHEN** the tool validates the input
- **THEN** the tool returns a structured error citing both arguments and explaining the conflict
- **AND** no question scan is performed

## MODIFIED Requirements

### Requirement: Default-mode processes the oldest unprocessed question

When `reprocessQuestionIds` is absent or an empty array, the tool SHALL process EVERY question belonging to the OLDEST pending BATCH for the named game. The selection algorithm SHALL be:

1. Build the pending set: questions where `postedAt !== undefined` AND `processedAt === undefined`.
2. Group the pending set by `batchId`. Every question whose `batchId === undefined` (legacy or otherwise) SHALL form its own singleton group of size 1, keyed by the question's `id` (so two undefined-`batchId` rows do NOT merge into the same group).
3. For each group, compute its `minPostedAt = min(question.postedAt for question in group)`.
4. Select the group with the smallest `minPostedAt`. Ties broken by lexicographic comparison of the group key (`batchId` or question id).
5. Sort the selected group's questions by `postedAt` ascending and process them in that order.
6. Stamp `processedAt = (ctx.asOf ?? Date.now())` on EACH processed question before returning.

The tool SHALL emit the processed group as the `reveals` array, in `postedAt`-ascending order. `reveals.length` SHALL equal the size of the selected group — typically `1` for a single-question season, or `N` for an N-slot season `format`.

The tool SHALL NOT process more than one batch per default-mode call. Pending batches other than the selected one SHALL remain untouched (their `processedAt` stays `undefined`), to be drained one batch per fire on successive cron ticks.

When the pending set is empty, the tool SHALL return `reveals: []`, an up-to-date `leaderboard`, the `roundSummary` with `totalQuestions: 0`, and the `seasonStatus` if seasons are enabled.

The selection algorithm SHALL NOT inspect or filter by `season`. A pending batch tagged for a prior season remains eligible for selection if it is the oldest pending batch. This is an **accepted degenerate case**: when a reveal fire is the season's last fire (per the cron schedule) AND the oldest pending batch belongs to a prior season (because that batch's own reveal fire failed before today's season rollover), the season-rollover branch runs against the prior-season batch's reveal. The accepted recovery path is admin intervention via `reprocessQuestionIds` after the fact. See `design.md` Decision 5 for the rationale.

#### Scenario: One pending batch with three questions is revealed in full

- **GIVEN** three questions `Q1`, `Q2`, `Q3` in `games/main/questions.json` with `postedAt: T1, T2, T3` (where `T1 < T2 < T3`) and a shared `batchId: "batch-A"`, none with `processedAt` set
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `reveals.length` is `3`
- **AND** `reveals[0].questionId === "Q1"`, `reveals[1].questionId === "Q2"`, `reveals[2].questionId === "Q3"` (postedAt-ascending order)
- **AND** each row's `processedAt` is stamped before the call returns
- **AND** `reveals[i].wasReprocessed` is `false` for all i

#### Scenario: Oldest batch wins when two batches are pending

- **GIVEN** batch A contains `Q1, Q2` with `min(postedAt) = T1` and pending
- **AND** batch B contains `Q3, Q4` with `min(postedAt) = T2` (where `T1 < T2`) and pending
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `reveals.length` is `2`
- **AND** `reveals` contains `Q1` and `Q2` in postedAt-ascending order
- **AND** `Q3` and `Q4` remain pending (their `processedAt` is still `undefined`)

#### Scenario: Successive fires drain backlog one batch at a time

- **GIVEN** the prior fire processed batch A and left batch B (older than today's fresh batch C) pending
- **WHEN** the next `process_reveal_answers` call runs
- **THEN** batch B is selected (it is the oldest pending batch)
- **AND** batch C remains pending for the fire after that

#### Scenario: Legacy pending row with undefined batchId is a singleton

- **GIVEN** `Q_legacy` has `postedAt: T0` and no `batchId` (pre-deploy data) and no `processedAt`
- **AND** `Q1`, `Q2` are a fresh batch with `batchId: "batch-A"` and `postedAt: T1, T2` (with `T0 < T1`)
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `reveals.length` is `1`
- **AND** `reveals[0].questionId === "Q_legacy"`
- **AND** `Q1` and `Q2` remain pending

#### Scenario: Two legacy rows without batchId do not merge into one group

- **GIVEN** `Q_legacy1` and `Q_legacy2` both lack `batchId` and both are pending with `postedAt: T0, T1` (where `T0 < T1`)
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `reveals.length` is `1`
- **AND** `reveals[0].questionId === "Q_legacy1"` (the older one)
- **AND** `Q_legacy2` remains pending

#### Scenario: Tied minPostedAt — lexicographically-smaller batchId wins

- **GIVEN** batch `"batch-aaaa"` and batch `"batch-bbbb"` both have `min(postedAt) === T1` (identical to the millisecond)
- **AND** both batches are pending
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `reveals` contains `"batch-aaaa"`'s questions (the lexicographically-smaller group key wins the tie-break)
- **AND** `"batch-bbbb"`'s questions remain pending

#### Scenario: No pending questions returns empty reveals

- **GIVEN** every row in `games/main/questions.json` has both `postedAt` and `processedAt` set
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `reveals` is `[]`
- **AND** `leaderboard` still reflects the current standings for this game
- **AND** `roundSummary.totalQuestions` is `0` and `roundSummary.perPlayer` is `[]`
- **AND** the call does not throw

#### Scenario: Selected batch is processed without regard to season tag

- **GIVEN** batch A is the oldest pending batch and its rows carry `season: "season-prev"`
- **AND** the current season per `findCurrentSeason(state, now)` is `"season-curr"`
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** batch A is processed normally (the selection algorithm ignores `season`)
- **AND** `reveals` contains batch A's rows
- **AND** any season-rollover branch fires per its existing logic (`isLastFireOfSeason` derived from the cron schedule, not from the processed batch's season)

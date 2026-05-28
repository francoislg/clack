# trivia-reveal-processor

## Purpose

The trivia plugin exposes a `process_reveal_answers` MCP tool that absorbs all deterministic work previously performed by Claude across multiple tool calls (`fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, and seasonally `check_season_status` + `upsert_season`). The tool processes pending trivia questions for a game in default mode (oldest unprocessed) or reprocesses specified questions when an admin re-runs an analysis. It excludes the bot, flagged cheaters, and (for choice questions) multi-react voters from every field of its payload. When seasons are enabled, the tool performs rollover inline and reports the outcome via structured metadata.

## Requirements

### Requirement: `process_reveal_answers` MCP tool

The trivia plugin SHALL register an `admin`-tier MCP tool named `process_reveal_answers` that takes `{ game: string, reprocessQuestionIds?: string[] }` and returns a structured `ProcessRevealResult` payload. The tool SHALL absorb the deterministic work previously performed by Claude across `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers` (now removed), `retrieve_scores`, and (when seasons are enabled) `check_season_status` + `upsert_season` for the scheduled reveal flow.

For boolean and choice questions, the tool SHALL derive scored answers by **reading `games/<game>/answers.json` directly** (the rows already written by the button-click handlers); the tool SHALL NOT derive scoring from Slack message reactions. For freeform questions, the tool SHALL continue to read `answers.json` and assign verdicts via the inline batch judge as before.

For ALL formats, the tool SHALL fetch the question's Slack message reactions purely as commentary signal — the bot's own user ID and every flagged cheater for the question SHALL be stripped from reaction lists, and the remaining per-user emoji sets SHALL be surfaced in the payload's `reactions` field for the reveal renderer to riff on.

The returned payload SHALL have the following shape:

```ts
type ProcessRevealResult = {
  game: string;
  reveals: Array<{
    questionId: string;
    statement: string;
    category: string;
    emojis: string[];
    messageLink: string;
    wasReprocessed: boolean;
    answer:
      | { type: "boolean"; isTrue: boolean }
      | { type: "choice"; choices: string[]; correctIndex: number }
      | { type: "freeform"; expectedAnswer: string; acceptableAnswers?: string[]; gradingNotes?: string };
    voters:                                                                           // discriminated union on the question's stamped revealResponses
      | { revealResponses: "yes";
          correct: Array<{ userId: string; displayName: string; answerText?: string }>;   // answerText present on freeform only
          incorrect: Array<{ userId: string; displayName: string; answerText?: string }>; // answerText present on freeform only
          noAnswer: Array<{ userId: string; displayName: string }>;                       // reacted but did NOT submit a button answer
          reactions: Array<{                                                              // every reactor's full emoji set (bot + cheaters stripped)
            userId: string;
            displayName: string;
            emojis: string[];
          }> }
      | { revealResponses: "just-correctness";
          correct: Array<{ userId: string; displayName: string }>;                        // freeform Voters have NO answerText
          incorrect: Array<{ userId: string; displayName: string }>;                      // freeform Voters have NO answerText
          noAnswer: Array<{ userId: string; displayName: string }>;
          reactions: Array<{ userId: string; displayName: string; emojis: string[] }> }
      | { revealResponses: "no";
          reactions: Array<{ userId: string; displayName: string; emojis: string[] }> };
  }>;
  leaderboard: Array<{
    userId: string;
    displayName: string;
    totalCorrect: number;
    totalAnswered: number;
    accuracy: number;
    currentSeasonCorrect?: number;
    currentSeasonAnswered?: number;
  }>;
  roundSummary?: {                                                                    // OMITTED when any reveal entry has revealResponses !== "yes"
    totalQuestions: number;
    perPlayer: Array<{
      userId: string;
      displayName: string;
      correct: number;
      answered: number;
      roundMvp?: true;
    }>;
  };
  seasonStatus?: {
    currentSlug: string;
    isLastFireOfSeason: boolean;
    seasonClosed: boolean;
    newSeasonStarted?: { slug: string; expectedEndAt: number };
    mvp?: { userId: string; displayName: string; currentSeasonCorrect: number };
  };
};
```

For each reveal entry, the tool SHALL read the question's stamped `revealResponses` value (defaulting to `"yes"` for legacy rows that pre-date this proposal) and SHALL emit the corresponding `voters` shape:

- `"yes"`: full voter buckets with names; freeform Voters in `correct[]` and `incorrect[]` carry `answerText`.
- `"just-correctness"`: full voter buckets with names; freeform Voters in `correct[]` and `incorrect[]` have NO `answerText` field. The freeform judge still runs end-to-end (to score every submission); only the typed text is filtered from the payload.
- `"no"`: ONLY the `reactions` array is emitted. The `correct`, `incorrect`, and `noAnswer` fields SHALL be physically absent from the payload variant.

The `roundSummary` field SHALL be OMITTED from the payload when ANY reveal entry in the batch has `revealResponses !== "yes"`. When omitted, the field SHALL be entirely absent — no empty object, no `totalQuestions: 0` placeholder. When all entries have `revealResponses: "yes"`, the field SHALL be populated as today.

The leaderboard and per-entry `reactions` list SHALL be present regardless of any reveal entry's `revealResponses` value — these aggregates do not disclose per-question correctness.

The tool SHALL exclude the bot's own user ID and every user ID flagged as a cheater for the relevant question from EVERY field of the returned payload — `correct`, `incorrect`, `noAnswer`, and `reactions`. These exclusions SHALL be structural — the renderer SHALL NOT be required to filter the payload further. The tool SHALL determine the bot's user ID at call time (e.g. via `client.auth.test()`); it SHALL NOT hardcode a specific value.

The tool SHALL NOT void or specially classify "multi-react" voters (users who reacted with multiple numbered or thumb emoji). Reactions are no longer interpreted as votes; multiple reactions are just multiple emoji in that user's `reactions[].emojis` array.

The tool SHALL classify users as follows:

- A user with a row in `answers.json` for this question whose `correct === true` lands in `voters.correct`.
- A user with a row in `answers.json` for this question whose `correct === false` lands in `voters.incorrect`.
- A user with NO row in `answers.json` for this question AND at least one reaction on the message lands in `voters.noAnswer`.
- A user with at least one reaction on the message lands in `voters.reactions` with their full emoji set, regardless of whether they also have an `answers.json` row.

A user who answered correctly AND reacted appears in BOTH `voters.correct` AND `voters.reactions` — the buckets are not mutually exclusive.

For freeform questions, the inline batch judge runs as today and writes verdicts into `answers.json` before the buckets are assembled.

#### Scenario: Tool registers at admin tier

- **WHEN** the trivia plugin loads
- **THEN** `process_reveal_answers` is registered on the trivia MCP server with `minRole: "admin"`
- **AND** the tool is callable as `mcp__trivia__process_reveal_answers`

#### Scenario: Boolean scoring reads from answers.json

- **GIVEN** a posted boolean question with `isTrue: true`
- **AND** `answers.json` contains `{ userId: "U1", answer: true, correct: true }`, `{ userId: "U2", answer: false, correct: false }`, `{ userId: "U3", answer: true, correct: true }`
- **WHEN** `process_reveal_answers({ game })` is called
- **THEN** `reveals[0].voters.correct` contains U1 and U3 (in some order)
- **AND** `reveals[0].voters.incorrect` contains U2
- **AND** no reaction-based scoring is performed

#### Scenario: Choice scoring reads from answers.json

- **GIVEN** a posted choice question with `correctIndex: 2`
- **AND** `answers.json` contains `{ userId: "U1", answerIndex: 2, correct: true }`, `{ userId: "U2", answerIndex: 0, correct: false }`
- **WHEN** `process_reveal_answers({ game })` is called
- **THEN** `voters.correct` contains U1
- **AND** `voters.incorrect` contains U2

#### Scenario: Reactions surfaced as commentary regardless of answer

- **GIVEN** a boolean question
- **AND** user U1 clicked the TRUE button AND added a `:fire:` reaction
- **AND** user U2 added only a `:turtle:` reaction without clicking any button
- **WHEN** `process_reveal_answers({ game })` is called
- **THEN** `voters.correct` contains U1
- **AND** `voters.noAnswer` contains U2
- **AND** `voters.reactions` contains `{ userId: "U1", emojis: ["fire"] }` AND `{ userId: "U2", emojis: ["turtle"] }`

#### Scenario: Bot user ID is excluded from every voter list

- **GIVEN** the bot reacted with `:+1:` on a question's message
- **WHEN** `process_reveal_answers({ game })` is called and returns
- **THEN** the bot's user ID does not appear in any `voters.correct`, `voters.incorrect`, `voters.noAnswer`, or `voters.reactions` array

#### Scenario: Cheaters are excluded from every voter list

- **GIVEN** users U1 and U2 are flagged as cheaters for the target questionId via `cheats.json`
- **AND** U1 clicked TRUE (row in answers.json), U2 reacted with `:-1:` (no row)
- **WHEN** `process_reveal_answers({ game })` is called
- **THEN** neither U1 nor U2 appears in `voters.correct`, `voters.incorrect`, `voters.noAnswer`, or `voters.reactions`

#### Scenario: noAnswer bucket — reacted but never clicked

- **GIVEN** user U1 added `:thinking:` and `:question:` reactions but never clicked a vote button
- **WHEN** `process_reveal_answers({ game })` is called
- **THEN** U1 appears in `voters.noAnswer`
- **AND** U1 appears in `voters.reactions` with `emojis: ["thinking", "question"]` (or any order)
- **AND** U1 does NOT appear in `voters.correct` or `voters.incorrect`

#### Scenario: Question stamped revealResponses="yes" emits full named buckets

- **GIVEN** a boolean question `Q1` stamped with `revealResponses: "yes"`, with answers in `answers.json`: `{ U1: true (correct), U2: false (wrong) }`
- **WHEN** `process_reveal_answers` runs
- **THEN** `reveals[0].voters.revealResponses === "yes"`
- **AND** `voters.correct` contains the U1 Voter
- **AND** `voters.incorrect` contains the U2 Voter
- **AND** `voters.noAnswer` is an array (possibly empty)
- **AND** `voters.reactions` is an array (possibly empty)

#### Scenario: Question stamped revealResponses="just-correctness" emits named buckets without freeform answerText

- **GIVEN** a freeform question `Q2` stamped `revealResponses: "just-correctness"` with pending rows `{ U1: "Jack Bruce" (judged correct), U2: "Sting" (judged incorrect) }`
- **WHEN** `process_reveal_answers` runs and the judge flips both rows
- **THEN** `reveals[0].voters.revealResponses === "just-correctness"`
- **AND** `voters.correct` contains a Voter `{ userId: "U1", displayName: ... }` with NO `answerText` field
- **AND** `voters.incorrect` contains a Voter `{ userId: "U2", displayName: ... }` with NO `answerText` field

#### Scenario: Question stamped revealResponses="just-correctness" on boolean still emits full buckets (no answerText to strip)

- **GIVEN** a boolean question stamped `revealResponses: "just-correctness"`
- **WHEN** `process_reveal_answers` runs
- **THEN** `voters.revealResponses === "just-correctness"`
- **AND** `voters.correct` and `voters.incorrect` contain named Voters (boolean voters never had `answerText` in any mode)

#### Scenario: Question stamped revealResponses="no" emits only reactions

- **GIVEN** a question `Q3` stamped `revealResponses: "no"` with several answer rows and several reactions on the Slack message
- **WHEN** `process_reveal_answers` runs
- **THEN** `reveals[0].voters.revealResponses === "no"`
- **AND** the `voters` object has NO `correct`, `incorrect`, or `noAnswer` field
- **AND** `voters.reactions` contains every reactor's emoji set (bot + cheaters excluded)

#### Scenario: Legacy questions without stamped revealResponses default to "yes"

- **GIVEN** a question stamped with `postedAt` but no `revealResponses` field (pre-feature row)
- **WHEN** `process_reveal_answers` runs
- **THEN** `voters.revealResponses === "yes"` (the default is applied)
- **AND** the payload variant carries the full `correct` / `incorrect` / `noAnswer` / `reactions` shape

#### Scenario: roundSummary omitted when any reveal entry has restricted mode

- **GIVEN** a 3-question batch where slot 0 stamped `revealResponses: "yes"`, slot 1 stamped `"just-correctness"`, slot 2 stamped `"yes"`
- **WHEN** `process_reveal_answers` runs and selects this batch
- **THEN** the returned payload has NO `roundSummary` field

#### Scenario: roundSummary present when all reveal entries are "yes"

- **GIVEN** a 3-question batch where all slots stamped `revealResponses: "yes"`
- **WHEN** `process_reveal_answers` runs and selects this batch
- **THEN** the returned payload has `roundSummary.totalQuestions === 3` with a populated `perPlayer` array

#### Scenario: Leaderboard present regardless of revealResponses mode

- **GIVEN** a single-question reveal stamped `revealResponses: "no"`
- **WHEN** `process_reveal_answers` runs
- **THEN** the returned payload has a populated `leaderboard` field (aggregate stats are not gated by `revealResponses`)

#### Scenario: Cheaters excluded from all variant shapes

- **GIVEN** a cheater U_cheat is flagged for the question
- **AND** U_cheat clicked a button AND reacted with `:fire:`
- **WHEN** `process_reveal_answers` runs for a `revealResponses: "yes"` question
- **THEN** U_cheat is absent from `voters.correct`, `voters.incorrect`, `voters.noAnswer`, and `voters.reactions`
- **AND** for a `revealResponses: "no"` question, U_cheat is absent from `voters.reactions`

#### Scenario: Multi-emoji reactions do not void scoring

- **GIVEN** user U1 clicked TRUE on a boolean question whose `isTrue: true`
- **AND** U1 also reacted with both `:+1:` and `:-1:` on the message
- **WHEN** `process_reveal_answers({ game })` is called
- **THEN** U1 appears in `voters.correct` (the button click is the source of truth; reactions don't void anything)
- **AND** U1's `voters.reactions` entry has `emojis: ["+1", "-1"]` (or any order)

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

### Requirement: Reprocess mode hard-deletes and re-derives the listed questions

When `reprocessQuestionIds` is a non-empty array, the tool SHALL process EACH listed questionId in that order:

1. Hard-delete every `SubmittedAnswer` row in `games/<game>/answers.json` whose `questionId` matches.
2. Stamp `processedAt = Date.now()` on each question (overwriting any prior value).
3. Include the resulting reveal in the returned `reveals[]` with `wasReprocessed: true`.

Because answers are no longer derivable from Slack reactions, **reprocess mode in this revised flow does NOT re-create scored answer rows**. After hard-delete, the `voters.correct` and `voters.incorrect` buckets for the reprocessed question SHALL be empty. The intent of reprocess mode shifts from "re-score against the current cheater list" to "wipe and re-render an already-revealed question's payload" — used after manual answer-file edits, or to surface freshly-flagged cheaters' removal from the round.

Freeform reprocess mode SHALL NOT be supported (no public reaction source to re-derive from), per existing behavior.

#### Scenario: Reprocess boolean question wipes its scored rows

- **GIVEN** boolean question `Q1` with 3 rows in `answers.json`
- **WHEN** `process_reveal_answers({ game: "main", reprocessQuestionIds: ["Q1"] })` is called
- **THEN** the 3 rows for `Q1` are deleted
- **AND** `reveals[0].wasReprocessed === true`
- **AND** `reveals[0].voters.correct` and `voters.incorrect` are empty arrays
- **AND** `Q1.processedAt` is overwritten with the current time

#### Scenario: Reprocess re-fetches reactions for the commentary list

- **GIVEN** boolean question `Q1` with one cheater U_cheat newly flagged after the original reveal
- **WHEN** `process_reveal_answers({ game, reprocessQuestionIds: ["Q1"] })` is called
- **THEN** `reveals[0].voters.reactions` excludes U_cheat (cheater filtering applies)
- **AND** the answers.json wipe is unaffected by the cheater set

#### Scenario: Reprocess refuses freeform questions

- **WHEN** `process_reveal_answers({ game, reprocessQuestionIds: ["Q_freeform"] })` is called
- **THEN** the call returns a per-id error for `Q_freeform` stating reprocess mode is not supported for freeform questions
- **AND** no rows are deleted

### Requirement: Tool internally composes leaderboard and season-status logic

The tool SHALL internally invoke shared helpers — equivalent to the implementations behind `retrieve_scores` and `check_season_status` — to populate the `leaderboard` and `seasonStatus` fields of its return value. Specifically:

- The `leaderboard` field SHALL be the result of the same aggregation logic used by the `retrieve_scores` tool (a shared `computeLeaderboard` helper SHALL be the single source of truth for ranking, and both tools SHALL call it).
- The `seasonStatus` field SHALL be populated when and only when `trivia.seasons.enabled === true`. Its `currentSlug` and `isLastFireOfSeason` values SHALL be computed identically to the `check_season_status` MCP tool.
- When `seasons.enabled` is `false`, the `seasonStatus` field SHALL be omitted from the return value.

#### Scenario: Leaderboard matches retrieve_scores for the same game

- **GIVEN** seasons disabled and `games/main/answers.json` contains a fixed set of answer rows
- **WHEN** `process_reveal_answers({ game: "main" })` and `retrieve_scores({ game: "main", sortBy: "totalCorrect" })` are both invoked
- **THEN** the `leaderboard` field of the first call's return matches the `leaderboard` array returned by the second call, entry-for-entry (same ordering, same per-user totals)

#### Scenario: seasonStatus omitted when seasons disabled

- **GIVEN** `config.trivia.seasons.enabled` is `false` (or absent)
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** the return value has no `seasonStatus` field

#### Scenario: seasonStatus populated when seasons enabled

- **GIVEN** `config.trivia.seasons.enabled` is `true` and a current season exists for the game
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `seasonStatus.currentSlug` matches the current season's slug
- **AND** `seasonStatus.isLastFireOfSeason` reflects whether today is the season's last scheduled reveal date

### Requirement: Season rollover happens inside the tool

When `seasons.enabled === true` AND the tool's internal `check_season_status` computation reports `isLastFireOfSeason: true`, the tool SHALL perform the season-end rollover inline, before returning. Rollover consists of:

1. Stamping `endedAt = Date.now()` on the closing season entry (idempotent — no-op if `endedAt` is already set).
2. If no future season entry exists in this game's `seasons.json` with `startedAt > now`, creating a continuation season entry. The continuation season SHALL inherit `categories`, `questionTypes`, and `format` from the closing season (deep copies of each field; absent fields stay absent). The continuation's `slug` SHALL be deterministically derived (e.g. `season-YYYY-MM` for the next month). The continuation's `startedAt` SHALL be `Date.now()` and `expectedEndAt` SHALL be end-of-current-UTC-month.

The continuation's inheritance of `categories` is a **behavioral change** from the prior rule (which copied from `categories.json` baseline). The "repeat" semantic is intentional: auto-continuation means "keep going with the same setup", and resetting any one field while inheriting the others is harder to reason about than uniform inheritance. Staged future seasons (entries with `startedAt > now` already on the timeline at the moment of rollover) SHALL NOT be replaced or augmented — admin intent overrides inheritance.

The tool SHALL report the outcome via `seasonStatus.seasonClosed` (true iff this run stamped `endedAt`) and, when a continuation was created, `seasonStatus.newSeasonStarted: { slug, expectedEndAt }`. The tool SHALL identify the season MVP (player at index 0 of the current-season-ordered leaderboard) and include them in `seasonStatus.mvp` for the renderer.

When `isLastFireOfSeason` is `false`, the tool SHALL NOT perform any rollover, SHALL NOT mutate any season entry, and SHALL set `seasonStatus.seasonClosed: false` with no `newSeasonStarted` field.

#### Scenario: Last-fire reveal closes the season inline

- **GIVEN** `seasons.enabled` is `true`, the current season's `expectedEndAt` makes today its last fire, and no future season is queued
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** before the call returns, the closing season's entry in `games/main/seasons.json` has `endedAt` stamped to a value close to `Date.now()`
- **AND** a new season entry is appended with a fresh slug, `startedAt` close to `Date.now()`, and `expectedEndAt` set to end-of-current-UTC-month
- **AND** the returned `seasonStatus.seasonClosed` is `true`
- **AND** `seasonStatus.newSeasonStarted` references the new entry's slug and expectedEndAt

#### Scenario: Auto-continuation inherits categories from the closing season

- **GIVEN** the closing season's `categories` is `["Marine Biology", "Cephalopods", "Tides"]` (a themed pool that differs from the global baseline)
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry's `categories` is a deep copy of `["Marine Biology", "Cephalopods", "Tides"]`
- **AND** the new entry's `categories` is NOT a copy of the global `categories.json` baseline

#### Scenario: Auto-continuation inherits questionTypes from the closing season

- **GIVEN** the closing season's `questionTypes` is `{ choice: 1 }`
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry's `questionTypes` is `{ choice: 1 }`

#### Scenario: Auto-continuation inherits format from the closing season

- **GIVEN** the closing season has `format: { questions: [{ label: "GK 1" }, { label: "History Choice", questionTypes: { choice: 1 } }] }`
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry's `format` is a deep copy of the closing season's `format`
- **AND** the next question-cron fire for this game posts 2 questions matching the inherited slot structure

#### Scenario: Auto-continuation absent fields stay absent

- **GIVEN** the closing season has no `questionTypes` field and no `format` field
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry has no `questionTypes` field and no `format` field
- **AND** the new entry's `categories` is still a deep copy of the closing season's `categories`

#### Scenario: Mid-season reveal does not roll over

- **GIVEN** `seasons.enabled` is `true` and today is NOT the last fire of the current season
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `games/main/seasons.json` is unchanged after the call
- **AND** `seasonStatus.seasonClosed` is `false`
- **AND** `seasonStatus.newSeasonStarted` is absent

#### Scenario: Last-fire reveal with continuation already queued does not create another

- **GIVEN** `seasons.enabled` is `true`, today is the last fire of the current season, AND a future season already exists with `startedAt > now`
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** the closing season is stamped with `endedAt`
- **AND** NO additional season entry is appended (the existing future entry is honored as the continuation)
- **AND** the existing future entry is NOT modified — its `categories`, `questionTypes`, and `format` retain whatever values the admin set
- **AND** `seasonStatus.seasonClosed` is `true`
- **AND** `seasonStatus.newSeasonStarted` is absent (no new entry was created by this run)

#### Scenario: Season MVP is identified

- **GIVEN** `seasons.enabled` is `true`, today is the last fire, and Alice leads the current-season leaderboard with the highest `currentSeasonCorrect`
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `seasonStatus.mvp.userId` equals Alice's user ID
- **AND** `seasonStatus.mvp.currentSeasonCorrect` equals her current-season correct count

### Requirement: Per-fire round summary in payload

The `ProcessRevealResult` payload returned by `process_reveal_answers` SHALL include a `roundSummary` field describing each player's correctness across this fire's revealed questions when all revealed questions have `revealResponses: "yes"`:

```ts
roundSummary: {
  totalQuestions: number; // === reveals.length
  perPlayer: Array<{
    userId: string;
    displayName: string;
    correct: number; // count of reveals where this player appears in voters.correct
    answered: number; // count of reveals where this player appears in any of voters.{correct, incorrect, noAnswer}
    roundMvp?: true; // present iff this player is tied for the highest `correct` count this fire
  }>;
}
```

The field SHALL be OMITTED (not present as `undefined` or an empty object) when ANY reveal entry in the payload has `revealResponses !== "yes"`.

When all entries have `revealResponses: "yes"`, the field SHALL be present whenever `reveals.length >= 1` — including length-1 reveals (where it describes the one question). When `reveals.length === 0` (no pending questions), `roundSummary.totalQuestions` SHALL be `0` and `perPlayer` SHALL be `[]`.

`perPlayer` SHALL include only players who appear in at least one reveal's voter list for this fire — players with `answered === 0` SHALL NOT be present.

`perPlayer` SHALL be sorted by `correct` descending, ties broken by `displayName` ascending (case-insensitive, locale-sensitive comparison).

`roundMvp: true` SHALL be set on EVERY player tied for the highest `correct` value in `perPlayer`. When no player has `correct > 0`, `roundMvp` SHALL be absent from all entries.

The structural-exclusion guarantees of the `voters` field carry through to `roundSummary` — the bot and flagged cheaters are absent from the counts because they are absent from the source `voters` lists. The renderer SHALL NOT need to filter `perPlayer`.

#### Scenario: Length-1 reveal with "yes" mode still produces a roundSummary

- **GIVEN** one pending question stamped `revealResponses: "yes"` with `voters.correct: [alice, bob]` and `voters.incorrect: [carol]`
- **WHEN** `process_reveal_answers` returns
- **THEN** `roundSummary.totalQuestions` equals `1`
- **AND** `roundSummary.perPlayer` includes alice/bob with `correct: 1, answered: 1`, carol with `correct: 0, answered: 1`
- **AND** alice and bob both carry `roundMvp: true` (tied for top); carol does not

#### Scenario: Length-3 reveal with mixed modes omits roundSummary

- **GIVEN** three pending questions, all stamped with `revealResponses: "yes"` except Q2 which has `revealResponses: "just-correctness"`
- **WHEN** `process_reveal_answers` returns
- **THEN** the payload has NO `roundSummary` field (even though most entries are "yes")

#### Scenario: Length-3 reveal with all "yes" aggregates per player

- **GIVEN** three pending questions, all stamped `revealResponses: "yes"`
- **AND** alice voted correctly on Q1 and Q2, incorrectly on Q3
- **AND** bob voted correctly on Q1, did not vote on Q2, voted correctly on Q3
- **AND** carol voted correctly on all three
- **WHEN** `process_reveal_answers` returns
- **THEN** `roundSummary.totalQuestions` equals `3`
- **AND** alice has `correct: 2, answered: 3`
- **AND** bob has `correct: 2, answered: 2`
- **AND** carol has `correct: 3, answered: 3, roundMvp: true`
- **AND** neither alice nor bob carries `roundMvp`

#### Scenario: Player who answered zero questions is omitted

- **GIVEN** two pending questions, both stamped `revealResponses: "yes"`
- **AND** dave voted on neither
- **WHEN** `process_reveal_answers` returns
- **THEN** dave does NOT appear in `roundSummary.perPlayer`

#### Scenario: Round MVPs share the title on a tie

- **GIVEN** four players all scoring 2/3 correct on a 3-question fire, all stamped `revealResponses: "yes"`
- **WHEN** `process_reveal_answers` returns
- **THEN** all four entries in `roundSummary.perPlayer` carry `roundMvp: true`

#### Scenario: No correct answers → no MVPs

- **GIVEN** a fire where every voter was incorrect on every question, all stamped `revealResponses: "yes"`
- **WHEN** `process_reveal_answers` returns
- **THEN** every entry in `roundSummary.perPlayer` has `correct: 0`
- **AND** no entry carries `roundMvp`

#### Scenario: Empty payload still carries a roundSummary

- **GIVEN** no pending questions for the game
- **WHEN** `process_reveal_answers` returns
- **THEN** `reveals` is `[]`
- **AND** `roundSummary.totalQuestions` is `0`
- **AND** `roundSummary.perPlayer` is `[]`

#### Scenario: Cheaters do not appear in roundSummary

- **GIVEN** a question where bob is a flagged cheater
- **WHEN** `process_reveal_answers` returns
- **THEN** bob does NOT appear in `roundSummary.perPlayer` (structurally excluded from `voters`)

### Requirement: `processedAt` field on TriviaQuestion

The `TriviaQuestion` type SHALL gain an optional `processedAt?: number` field (epoch milliseconds). The field SHALL be stamped by `process_reveal_answers` when (a) processing the oldest pending question in default mode, or (b) reprocessing a question via `reprocessQuestionIds`. Legacy rows lacking the field SHALL NOT be retroactively populated by reads — they remain `undefined` until explicitly set by a write or by a one-shot back-fill at deploy time (see migration plan in the change's design document).

The default-mode question selection filter SHALL be `(question.postedAt !== undefined) AND (question.processedAt === undefined)`.

#### Scenario: processedAt is stamped on default-mode processing

- **GIVEN** a question with `postedAt: 1000`, no `processedAt`
- **WHEN** the tool processes it in default mode
- **THEN** after the call, the question row's `processedAt` is a positive number close to `Date.now()`

#### Scenario: processedAt is overwritten on reprocess

- **GIVEN** a question with `processedAt: 5000`
- **WHEN** the tool reprocesses it via `reprocessQuestionIds`
- **THEN** after the call, the question row's `processedAt` is a positive number greater than `5000`

#### Scenario: processedAt makes a question ineligible for default-mode selection

- **GIVEN** question Q has `postedAt: 1000` and `processedAt: 2000`, and question Q' has `postedAt: 1500` and no `processedAt`
- **WHEN** the tool is invoked in default mode
- **THEN** Q' is selected (Q is excluded by the filter)

### Requirement: `asOf` flows from tool context, not tool arguments

The shared `QueryToolContext` type SHALL gain an optional `asOf?: Date` field. The cron scheduler (in `executeJob` / `executeDynamicJob`) SHALL populate it when the job is being replayed with an explicit `asOf` parameter. The `process_reveal_answers` tool SHALL read this context value to define its effective "now" for `processedAt`-stamping and for the season-status computation. The tool's Zod argument schema SHALL NOT include an `asOf` parameter — the value is always sourced from context.

When `ctx.asOf` is absent, the tool SHALL use real wall-clock `Date.now()`.

#### Scenario: Tool reads asOf from context during replay

- **GIVEN** the cron scheduler invokes a replay with `asOf: <T>`
- **AND** the tool runs in that session
- **THEN** the `processedAt` stamped by the tool equals (approximately) `T.getTime()`
- **AND** the `seasonStatus.isLastFireOfSeason` computation uses `T` as the effective current date

#### Scenario: Tool uses wall-clock time when asOf is absent

- **GIVEN** the tool is invoked outside of a replay context (cron tick, admin Slack invocation)
- **THEN** the `processedAt` stamped by the tool is close to wall-clock `Date.now()`

### Requirement: Idempotency of repeated default-mode calls

In default mode, the tool SHALL be safe to call repeatedly without unintended side effects. After a successful default-mode call that processed question Q, a second default-mode call on the same game SHALL return `reveals: []` (because Q now has `processedAt` set) — it SHALL NOT redo Q's processing, SHALL NOT re-write Q's answers, and SHALL NOT re-stamp Q's `processedAt`.

A repeated call MAY still observe other side-effecting changes if new state has accrued between calls (e.g. new questions posted, new cheats flagged, new season transitions) — idempotency applies to the previously-processed question, not to the entire system state.

#### Scenario: Second default-mode call after a successful first call returns empty reveals

- **GIVEN** the first call processed question Q and stamped its `processedAt`
- **WHEN** a second default-mode call is made immediately afterward and no other questions are pending
- **THEN** `reveals` is `[]`
- **AND** Q's `processedAt` is unchanged from the value stamped by the first call

### Requirement: Tool registration retains existing hot-path tools for ad-hoc use

The introduction of `process_reveal_answers` SHALL NOT remove the registration of any existing trivia or clack tool. `submit_answers`, `get_question_history`, `find_previous_questions`, `retrieve_scores`, and `check_season_status` SHALL remain registered with their current behavior and role tiers, available for ad-hoc admin queries. They simply leave the cron-driven reveal hot path. `fetch_channel_messages` (on the clack core MCP server) is similarly unaffected.

#### Scenario: Existing tools remain callable

- **GIVEN** the trivia plugin loaded with the new `process_reveal_answers` tool registered
- **WHEN** Claude (in any session with sufficient role) attempts to call `submit_answers`, `get_question_history`, `find_previous_questions`, `retrieve_scores`, or `check_season_status`
- **THEN** the call resolves to the existing tool implementation with unchanged behavior

### Requirement: Freeform Reveal Invokes Inline Batch Judge

`process_reveal_answers` SHALL detect any freeform questions in the batch it is about to process. For each freeform question with at least one pending `SubmittedAnswer` row (`correct === undefined`), the tool SHALL collect those rows and include them in a single batched judge prompt sent via `sdk.askClaude` to a small/fast Claude model (Haiku-class, default `"claude-haiku-4-5-20251001"`). The prompt SHALL include for each question its `statement`, `expectedAnswer`, `acceptableAnswers[]` (if any), and `gradingNotes` (if any), and for each pending submission the row's stable key and `answerText`. The tool SHALL parse per-row verdicts from the response and SHALL call `updateAnswer(rowKey, { correct: <verdict> })` for each row to flip `correct` from undefined to the judged value.

When the batch contains no freeform questions, OR when every freeform question in the batch has zero pending rows, NO `sdk.askClaude` call SHALL be made.

#### Scenario: Batch with freeform invokes judge once

- **WHEN** `process_reveal_answers` is processing a batch with two freeform questions, each with three pending answers
- **THEN** exactly one `sdk.askClaude` call is made
- **AND** the prompt contains six submissions grouped under their respective questions
- **AND** exactly six `updateAnswer` calls flip each row's `correct` from undefined to the judged value

#### Scenario: No freeform in batch — no judge call

- **WHEN** `process_reveal_answers` is processing a batch containing only boolean and choice questions
- **THEN** zero `sdk.askClaude` calls are made
- **AND** the existing reveal flow (reaction fetch → categorize → write `SubmittedAnswer`) runs unchanged

#### Scenario: Freeform question with no submissions

- **WHEN** the batch contains a freeform question that nobody answered
- **THEN** that question contributes no entries to the judge prompt
- **AND** if all freeform questions in the batch have no submissions, no `sdk.askClaude` call is made
- **AND** the reveal payload for that question reports empty `voters.correct` and `voters.incorrect` lists

### Requirement: Freeform Judge Prompt Multi-Guess Rule

The reveal-time judge prompt SHALL instruct the model to mark as `correct: false` (with reason `multiple-guess`) any answer that hedges between two or more distinct guesses (e.g. `"Paris or London"`, `"either A or B"`, `"A | B | C"`), even when one of the guesses matches the expected answer. The prompt SHALL explicitly carve out single-answer-with-qualifier forms — `"Tokyo, Japan"`, `"Paris (capital of France)"`, `"rock and roll"` — as valid single-guess answers that should be judged on their merit.

#### Scenario: Multi-guess marked incorrect

- **WHEN** the judge is presented `answerText: "Paris or London"` against `expectedAnswer: "Paris"`
- **THEN** the per-row verdict is `correct: false`
- **AND** the verdict's reason indicates `multiple-guess`

#### Scenario: Qualifier-form accepted

- **WHEN** the judge is presented `answerText: "Tokyo, Japan"` against `expectedAnswer: "Tokyo"`
- **THEN** the per-row verdict is `correct: true`

### Requirement: Freeform Reveal Payload Carries answerText

For freeform reveal entries in the payload produced by `process_reveal_answers`, every entry in `voters.correct[]` and `voters.incorrect[]` SHALL carry an `answerText: string` field with the user's submitted text. `voters.fenceSitters[]` SHALL be `[]` and `voters.wildcards[]` SHALL be `[]` for freeform reveal entries (free-form has no fence-sitting or wildcard reactions by construction). Boolean and choice reveal entries' voter lists SHALL NOT gain an `answerText` field.

#### Scenario: Freeform voter entries carry answerText

- **WHEN** a freeform reveal entry is produced for a question with two correct answers ("Paris", "Paris, France") and one incorrect answer ("London")
- **THEN** `voters.correct[]` has two entries, each carrying the user's `answerText`
- **AND** `voters.incorrect[]` has one entry carrying `answerText: "London"`
- **AND** `voters.fenceSitters` is `[]` and `voters.wildcards` is `[]`

#### Scenario: Boolean reveal entry unchanged

- **WHEN** a boolean reveal entry is produced
- **THEN** voter entries do NOT carry `answerText`
- **AND** the payload shape is identical to today

### Requirement: `"just-winners"` reveal-disclosure variant

The `process_reveal_answers` payload's `voters` discriminated union SHALL support a fourth variant for questions stamped `revealResponses: "just-winners"`. This variant names the correct voters only and reduces the incorrect and no-answer voters to anonymous counts, while preserving the reactions commentary:

```ts
| { revealResponses: "just-winners";
    correct: Array<{ userId: string; displayName: string; answerText?: string }>;  // answerText present on freeform only
    incorrectCount: number;   // count of scored-wrong voters; NO names
    noAnswerCount: number;    // count of reacted-but-did-not-answer voters; NO names
    reactions: Array<{ userId: string; displayName: string; emojis: string[] }> }
```

The `incorrect` and `noAnswer` named arrays SHALL be physically absent from this variant — only the integer counts are emitted. Bot and flagged cheaters SHALL be excluded from `correct`, the counts, and `reactions`, identical to the other modes. Freeform correct voters SHALL retain their typed `answerText` (the winning answer is celebratory and about to be revealed); no incorrect or no-answer typed text SHALL ever be emitted because those voters are not named.

The `incorrectCount` SHALL equal the number of voters whose `answers.json` row scored `correct === false` (after bot/cheater exclusion); `noAnswerCount` SHALL equal the number of users who reacted but have no scored answer row (after bot/cheater exclusion).

The `roundSummary` field SHALL remain OMITTED whenever any reveal entry in the batch is `"just-winners"` (it is `!== "yes"`), consistent with the existing all-`"yes"` gate.

#### Scenario: Boolean question stamped just-winners names winners and counts missers

- **GIVEN** a boolean question `Q1` stamped `revealResponses: "just-winners"` with answers `{ U1: correct, U2: wrong, U3: wrong }` and U4 reacted without answering
- **WHEN** `process_reveal_answers` processes `Q1`
- **THEN** `reveals[0].voters.revealResponses === "just-winners"`
- **AND** `voters.correct` contains the U1 Voter
- **AND** `voters.incorrectCount === 2`
- **AND** `voters.noAnswerCount === 1`
- **AND** the variant has no `incorrect` or `noAnswer` named arrays

#### Scenario: Freeform just-winners keeps winner answerText, never misser text

- **GIVEN** a freeform question `Q2` stamped `revealResponses: "just-winners"` with rows `{ U1: "Paris" (correct), U2: "London" (wrong) }`
- **WHEN** `process_reveal_answers` processes `Q2`
- **THEN** `voters.correct` contains a Voter for U1 carrying `answerText: "Paris"`
- **AND** `voters.incorrectCount === 1`
- **AND** no field of the payload contains the string `"London"`

#### Scenario: Everyone missed — winners bucket empty, miss count positive

- **GIVEN** a question stamped `revealResponses: "just-winners"` where every scored voter answered wrong
- **WHEN** `process_reveal_answers` processes it
- **THEN** `voters.correct` is an empty array
- **AND** `voters.incorrectCount` equals the number of wrong voters and is greater than 0

#### Scenario: just-winners entry omits roundSummary in a multi-question batch

- **GIVEN** a batch of two reveal entries where at least one is stamped `revealResponses: "just-winners"`
- **WHEN** `process_reveal_answers` returns the payload
- **THEN** the top-level `roundSummary` field is entirely absent

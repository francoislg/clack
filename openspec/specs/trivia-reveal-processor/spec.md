# trivia-reveal-processor

## Purpose

The trivia plugin exposes a `compute_answers` MCP tool that computes scored answers and a leaderboard snapshot. The tool processes pending trivia questions for a game in default mode (oldest unprocessed) or reprocesses specified questions when an admin re-runs an analysis. It excludes the bot, flagged cheaters, and (for choice questions) multi-react voters from every field of its payload. When seasons are enabled, the tool reports season status (including whether this is the last fire) so the caller can invoke season rollover separately via `start_new_season`.
## Requirements
### Requirement: `compute_answers` MCP tool

The trivia plugin SHALL register the reveal-compute tool under the name `compute_answers` (callable as `mcp__trivia__compute_answers`), at the `admin` tier. It SHALL be the renamed successor of `process_reveal_answers`: every retained requirement in this capability — batch selection, reading scored rows from `answers.json`, the discriminated `voters` payload, the freeform per-answer judge, the leaderboard/`roundSummary`/`seasonStatus` payload, `processedAt` stamping, `asOf` handling, reprocess mode, and the idempotency of repeated default-mode calls — SHALL continue to describe `compute_answers` unchanged under the new name.

Two responsibilities that previously lived inside the tool are removed (see the REMOVED requirements below): the tool SHALL NOT edit any Slack message (card edits move to `update_answers_block` in `trivia-card-projection`), and the tool SHALL NOT perform season rollover (rollover moves to `start_new_season`). The tool SHALL still **report** `seasonStatus` (including `isLastFireOfSeason`) so the caller can decide whether to invoke rollover.

For boolean and choice questions, the tool SHALL derive scored answers by **reading `games/<game>/answers.json` directly** (the rows already written by the button-click handlers); the tool SHALL NOT derive scoring from Slack message reactions. For freeform questions, the tool SHALL continue to read `answers.json` and assign verdicts via the per-answer reveal judge (see the "Freeform Reveal Invokes Per-Answer Judge" requirement).

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
    voters:                                                                           // discriminated union on the question's stamped revealResponses (DISPLAY only)
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
  roundSummary: {                                                                    // ALWAYS present; aggregate from scored answers, independent of revealResponses
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

For each reveal entry, the tool SHALL read the question's stamped `revealResponses` value (defaulting to `"yes"` for legacy rows that pre-date this proposal) and SHALL emit the corresponding `voters` shape. `revealResponses` governs ONLY this per-question `voters` DISPLAY shape — it has no effect on `roundSummary`, the leaderboard, or any aggregate:

- `"yes"`: full voter buckets with names; freeform Voters in `correct[]` and `incorrect[]` carry `answerText`.
- `"just-correctness"`: full voter buckets with names; freeform Voters in `correct[]` and `incorrect[]` have NO `answerText` field. The freeform judge still runs end-to-end (to score every submission); only the typed text is filtered from the payload.
- `"no"`: ONLY the `reactions` array is emitted. The `correct`, `incorrect`, and `noAnswer` fields SHALL be physically absent from the payload variant.

The `roundSummary` field SHALL ALWAYS be present in the payload — it is a per-player AGGREGATE scoreboard derived from the SCORED ANSWERS (the same source as `leaderboard`), NOT from the redacted `voters` payload, and is therefore INDEPENDENT of every entry's `revealResponses`. Its `perPlayer` array SHALL be empty only when nobody answered any revealed question this fire. See the "Per-fire round summary in payload" requirement for the full shape and computation.

The leaderboard and per-entry `reactions` list SHALL be present regardless of any reveal entry's `revealResponses` value — these aggregates do not disclose per-question correctness.

The tool SHALL exclude the bot's own user ID and every user ID flagged as a cheater for the relevant question from EVERY field of the returned payload — `correct`, `incorrect`, `noAnswer`, `reactions`, and the `roundSummary` aggregate. These exclusions SHALL be structural — the renderer SHALL NOT be required to filter the payload further. The tool SHALL determine the bot's user ID at call time (e.g. via `client.auth.test()`); it SHALL NOT hardcode a specific value.

The tool SHALL NOT void or specially classify "multi-react" voters (users who reacted with multiple numbered or thumb emoji). Reactions are no longer interpreted as votes; multiple reactions are just multiple emoji in that user's `reactions[].emojis` array.

The tool SHALL classify users as follows:

- A user with a row in `answers.json` for this question whose `correct === true` lands in `voters.correct`.
- A user with a row in `answers.json` for this question whose `correct === false` lands in `voters.incorrect`.
- A user with NO row in `answers.json` for this question AND at least one reaction on the message lands in `voters.noAnswer`.
- A user with at least one reaction on the message lands in `voters.reactions` with their full emoji set, regardless of whether they also have an `answers.json` row.

A user who answered correctly AND reacted appears in BOTH `voters.correct` AND `voters.reactions` — the buckets are not mutually exclusive.

For freeform questions, the per-answer reveal judge runs and writes verdicts into `answers.json` before the buckets are assembled.

#### Scenario: Tool is registered as compute_answers

- **WHEN** the trivia plugin loads
- **THEN** a tool named `compute_answers` is registered on the trivia MCP server with `minRole: "admin"`, callable as `mcp__trivia__compute_answers`
- **AND** no tool named `compute_answers` is registered

#### Scenario: Retained scoring behavior is unchanged under the new name

- **GIVEN** a posted boolean question with `isTrue: true` and `answers.json` rows `{ U1: true (correct), U2: false (wrong) }`
- **WHEN** `compute_answers({ game })` is called
- **THEN** `reveals[0].voters.correct` contains U1 and `voters.incorrect` contains U2
- **AND** the returned `leaderboard`, `roundSummary`, and (when seasons enabled) `seasonStatus` are computed exactly as the prior `compute_answers` tool produced them

#### Scenario: Boolean scoring reads from answers.json

- **GIVEN** a posted boolean question with `isTrue: true`
- **AND** `answers.json` contains `{ userId: "U1", answer: true, correct: true }`, `{ userId: "U2", answer: false, correct: false }`, `{ userId: "U3", answer: true, correct: true }`
- **WHEN** `compute_answers({ game })` is called
- **THEN** `reveals[0].voters.correct` contains U1 and U3 (in some order)
- **AND** `reveals[0].voters.incorrect` contains U2
- **AND** no reaction-based scoring is performed

#### Scenario: Choice scoring reads from answers.json

- **GIVEN** a posted choice question with `correctIndex: 2`
- **AND** `answers.json` contains `{ userId: "U1", answerIndex: 2, correct: true }`, `{ userId: "U2", answerIndex: 0, correct: false }`
- **WHEN** `compute_answers({ game })` is called
- **THEN** `voters.correct` contains U1
- **AND** `voters.incorrect` contains U2

#### Scenario: Reactions surfaced as commentary regardless of answer

- **GIVEN** a boolean question
- **AND** user U1 clicked the TRUE button AND added a `:fire:` reaction
- **AND** user U2 added only a `:turtle:` reaction without clicking any button
- **WHEN** `compute_answers({ game })` is called
- **THEN** `voters.correct` contains U1
- **AND** `voters.noAnswer` contains U2
- **AND** `voters.reactions` contains `{ userId: "U1", emojis: ["fire"] }` AND `{ userId: "U2", emojis: ["turtle"] }`

#### Scenario: Bot user ID is excluded from every voter list

- **GIVEN** the bot reacted with `:+1:` on a question's message
- **WHEN** `compute_answers({ game })` is called and returns
- **THEN** the bot's user ID does not appear in any `voters.correct`, `voters.incorrect`, `voters.noAnswer`, or `voters.reactions` array

#### Scenario: Cheaters are excluded from every voter list

- **GIVEN** users U1 and U2 are flagged as cheaters for the target questionId via `cheats.json`
- **AND** U1 clicked TRUE (row in answers.json), U2 reacted with `:-1:` (no row)
- **WHEN** `compute_answers({ game })` is called
- **THEN** neither U1 nor U2 appears in `voters.correct`, `voters.incorrect`, `voters.noAnswer`, or `voters.reactions`

#### Scenario: noAnswer bucket — reacted but never clicked

- **GIVEN** user U1 added `:thinking:` and `:question:` reactions but never clicked a vote button
- **WHEN** `compute_answers({ game })` is called
- **THEN** U1 appears in `voters.noAnswer`
- **AND** U1 appears in `voters.reactions` with `emojis: ["thinking", "question"]` (or any order)
- **AND** U1 does NOT appear in `voters.correct` or `voters.incorrect`

#### Scenario: Question stamped revealResponses="yes" emits full named buckets

- **GIVEN** a boolean question `Q1` stamped with `revealResponses: "yes"`, with answers in `answers.json`: `{ U1: true (correct), U2: false (wrong) }`
- **WHEN** `compute_answers` runs
- **THEN** `reveals[0].voters.revealResponses === "yes"`
- **AND** `voters.correct` contains the U1 Voter
- **AND** `voters.incorrect` contains the U2 Voter
- **AND** `voters.noAnswer` is an array (possibly empty)
- **AND** `voters.reactions` is an array (possibly empty)

#### Scenario: Question stamped revealResponses="just-correctness" emits named buckets without freeform answerText

- **GIVEN** a freeform question `Q2` stamped `revealResponses: "just-correctness"` with pending rows `{ U1: "Jack Bruce" (judged correct), U2: "Sting" (judged incorrect) }`
- **WHEN** `compute_answers` runs and the judge flips both rows
- **THEN** `reveals[0].voters.revealResponses === "just-correctness"`
- **AND** `voters.correct` contains a Voter `{ userId: "U1", displayName: ... }` with NO `answerText` field
- **AND** `voters.incorrect` contains a Voter `{ userId: "U2", displayName: ... }` with NO `answerText` field

#### Scenario: Question stamped revealResponses="no" emits only reactions

- **GIVEN** a question `Q3` stamped `revealResponses: "no"` with several answer rows and several reactions on the Slack message
- **WHEN** `compute_answers` runs
- **THEN** `reveals[0].voters.revealResponses === "no"`
- **AND** the `voters` object has NO `correct`, `incorrect`, or `noAnswer` field
- **AND** `voters.reactions` contains every reactor's emoji set (bot + cheaters excluded)

#### Scenario: Legacy questions without stamped revealResponses default to "yes"

- **GIVEN** a question stamped with `postedAt` but no `revealResponses` field (pre-feature row)
- **WHEN** `compute_answers` runs
- **THEN** `voters.revealResponses === "yes"` (the default is applied)
- **AND** the payload variant carries the full `correct` / `incorrect` / `noAnswer` / `reactions` shape

#### Scenario: roundSummary present and identical across reveal modes

- **GIVEN** a 3-question batch where slot 0 is `revealResponses: "yes"`, slot 1 is `"no"`, slot 2 is `"just-winners"`, and a player U1 has a scored answer on each
- **WHEN** `compute_answers` runs and selects this batch
- **THEN** the returned payload HAS a `roundSummary` field with `totalQuestions === 3`
- **AND** `roundSummary.perPlayer` tallies U1's scored answers across ALL three questions regardless of each question's display mode

#### Scenario: Leaderboard present regardless of revealResponses mode

- **GIVEN** a single-question reveal stamped `revealResponses: "no"`
- **WHEN** `compute_answers` runs
- **THEN** the returned payload has a populated `leaderboard` field (aggregate stats are not gated by `revealResponses`)

#### Scenario: Cheaters excluded from all variant shapes

- **GIVEN** a cheater U_cheat is flagged for the question
- **AND** U_cheat clicked a button AND reacted with `:fire:`
- **WHEN** `compute_answers` runs for a `revealResponses: "yes"` question
- **THEN** U_cheat is absent from `voters.correct`, `voters.incorrect`, `voters.noAnswer`, and `voters.reactions`
- **AND** for a `revealResponses: "no"` question, U_cheat is absent from `voters.reactions`

#### Scenario: Multi-emoji reactions do not void scoring

- **GIVEN** user U1 clicked TRUE on a boolean question whose `isTrue: true`
- **AND** U1 also reacted with both `:+1:` and `:-1:` on the message
- **WHEN** `compute_answers({ game })` is called
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
- **WHEN** `compute_answers({ game: "main" })` is called
- **THEN** `reveals.length` is `3`
- **AND** `reveals[0].questionId === "Q1"`, `reveals[1].questionId === "Q2"`, `reveals[2].questionId === "Q3"` (postedAt-ascending order)
- **AND** each row's `processedAt` is stamped before the call returns
- **AND** `reveals[i].wasReprocessed` is `false` for all i

#### Scenario: Oldest batch wins when two batches are pending

- **GIVEN** batch A contains `Q1, Q2` with `min(postedAt) = T1` and pending
- **AND** batch B contains `Q3, Q4` with `min(postedAt) = T2` (where `T1 < T2`) and pending
- **WHEN** `compute_answers({ game: "main" })` is called
- **THEN** `reveals.length` is `2`
- **AND** `reveals` contains `Q1` and `Q2` in postedAt-ascending order
- **AND** `Q3` and `Q4` remain pending (their `processedAt` is still `undefined`)

#### Scenario: Successive fires drain backlog one batch at a time

- **GIVEN** the prior fire processed batch A and left batch B (older than today's fresh batch C) pending
- **WHEN** the next `compute_answers` call runs
- **THEN** batch B is selected (it is the oldest pending batch)
- **AND** batch C remains pending for the fire after that

#### Scenario: Legacy pending row with undefined batchId is a singleton

- **GIVEN** `Q_legacy` has `postedAt: T0` and no `batchId` (pre-deploy data) and no `processedAt`
- **AND** `Q1`, `Q2` are a fresh batch with `batchId: "batch-A"` and `postedAt: T1, T2` (with `T0 < T1`)
- **WHEN** `compute_answers({ game: "main" })` is called
- **THEN** `reveals.length` is `1`
- **AND** `reveals[0].questionId === "Q_legacy"`
- **AND** `Q1` and `Q2` remain pending

#### Scenario: Two legacy rows without batchId do not merge into one group

- **GIVEN** `Q_legacy1` and `Q_legacy2` both lack `batchId` and both are pending with `postedAt: T0, T1` (where `T0 < T1`)
- **WHEN** `compute_answers({ game: "main" })` is called
- **THEN** `reveals.length` is `1`
- **AND** `reveals[0].questionId === "Q_legacy1"` (the older one)
- **AND** `Q_legacy2` remains pending

#### Scenario: Tied minPostedAt — lexicographically-smaller batchId wins

- **GIVEN** batch `"batch-aaaa"` and batch `"batch-bbbb"` both have `min(postedAt) === T1` (identical to the millisecond)
- **AND** both batches are pending
- **WHEN** `compute_answers({ game: "main" })` is called
- **THEN** `reveals` contains `"batch-aaaa"`'s questions (the lexicographically-smaller group key wins the tie-break)
- **AND** `"batch-bbbb"`'s questions remain pending

#### Scenario: No pending questions returns empty reveals

- **GIVEN** every row in `games/main/questions.json` has both `postedAt` and `processedAt` set
- **WHEN** `compute_answers({ game: "main" })` is called
- **THEN** `reveals` is `[]`
- **AND** `leaderboard` still reflects the current standings for this game
- **AND** `roundSummary.totalQuestions` is `0` and `roundSummary.perPlayer` is `[]`
- **AND** the call does not throw

#### Scenario: Selected batch is processed without regard to season tag

- **GIVEN** batch A is the oldest pending batch and its rows carry `season: "season-prev"`
- **AND** the current season per `findCurrentSeason(state, now)` is `"season-curr"`
- **WHEN** `compute_answers({ game: "main" })` is called
- **THEN** batch A is processed normally (the selection algorithm ignores `season`)
- **AND** `reveals` contains batch A's rows
- **AND** any season-rollover branch fires per its existing logic (`isLastFireOfSeason` derived from the cron schedule, not from the processed batch's season)

### Requirement: Reprocess mode re-derives verdicts on retained answers (never deletes)

When `reprocessQuestionIds` is a non-empty array, the tool SHALL process EACH listed questionId in that order:

1. Re-derive the `correct` verdict on EVERY retained `SubmittedAnswer` row in `games/<game>/answers.json` whose `questionId` matches, from the question's CURRENT answer key — boolean: `correct = (row.answer === question.isTrue)`; choice: `correct = (row.answerIndex === question.correctIndex)` — writing each verdict in place via `updateAnswer`.
2. Stamp `processedAt = Date.now()` on each question (overwriting any prior value).
3. Include the resulting reveal in the returned `reveals[]` with `wasReprocessed: true`.

The raw button-click submission (`answer` / `answerIndex`) is the canonical record and SHALL NOT be deleted or modified by reprocess — only the derived `correct` verdict is recomputed. Re-derivation is a full assignment that flips a verdict in EITHER direction: a stale `correct: true` becomes `false` when the raw answer no longer matches the corrected key, and a stale `correct: false` becomes `true` when it does. EVERY row for the question is re-derived (there is exactly one row per `(user, question)`). The intent of reprocess mode is "re-judge an already-revealed question against the current — possibly corrected — answer key", e.g. after an admin fixes a wrong `isTrue` / `correctIndex`.

Freeform reprocess mode SHALL NOT be supported: the judged modal submissions are immutable, so there is nothing to safely re-derive.

#### Scenario: Reprocess re-derives every row's verdict in both directions

- **GIVEN** boolean question `Q1` with `isTrue: true` and two retained rows: U1 (`answer: true`, stale `correct: false`) and U2 (`answer: false`, stale `correct: true`)
- **WHEN** `compute_answers({ game: "main", reprocessQuestionIds: ["Q1"] })` is called
- **THEN** both rows are retained (none deleted)
- **AND** U1's verdict is re-derived to `correct: true` (flip up) and U2's to `correct: false` (flip down)
- **AND** each row's raw `answer` is unchanged
- **AND** `reveals[0].wasReprocessed === true`
- **AND** `Q1.processedAt` is overwritten with the current time

#### Scenario: Reprocess never deletes answer rows

- **GIVEN** boolean question `Q1` with 3 retained rows in `answers.json`
- **WHEN** `compute_answers({ game: "main", reprocessQuestionIds: ["Q1"] })` is called
- **THEN** all 3 rows for `Q1` remain in `answers.json` (only their `correct` verdicts are recomputed)
- **AND** `reveals[0].wasReprocessed === true`

#### Scenario: Reprocess refuses freeform questions

- **WHEN** `compute_answers({ game, reprocessQuestionIds: ["Q_freeform"] })` is called
- **THEN** the call returns a per-id error for `Q_freeform` stating reprocess mode is not supported for freeform questions
- **AND** no rows are deleted

### Requirement: Tool internally composes leaderboard and season-status logic

The tool SHALL internally invoke shared helpers — equivalent to the implementations behind `retrieve_scores` and `check_season_status` — to populate the `leaderboard` and `seasonStatus` fields of its return value. Specifically:

- The `leaderboard` field SHALL be the result of the same aggregation logic used by the `retrieve_scores` tool (a shared `computeLeaderboard` helper SHALL be the single source of truth for ranking, and both tools SHALL call it).
- The `seasonStatus` field SHALL be populated when and only when `trivia.seasons.enabled === true`. Its `currentSlug` and `isLastFireOfSeason` values SHALL be computed identically to the `check_season_status` MCP tool.
- When `seasons.enabled` is `false`, the `seasonStatus` field SHALL be omitted from the return value.

#### Scenario: Leaderboard matches retrieve_scores for the same game

- **GIVEN** seasons disabled and `games/main/answers.json` contains a fixed set of answer rows
- **WHEN** `compute_answers({ game: "main" })` and `retrieve_scores({ game: "main", sortBy: "totalCorrect" })` are both invoked
- **THEN** the `leaderboard` field of the first call's return matches the `leaderboard` array returned by the second call, entry-for-entry (same ordering, same per-user totals)

#### Scenario: seasonStatus omitted when seasons disabled

- **GIVEN** `config.trivia.seasons.enabled` is `false` (or absent)
- **WHEN** `compute_answers({ game: "main" })` is called
- **THEN** the return value has no `seasonStatus` field

#### Scenario: seasonStatus populated when seasons enabled

- **GIVEN** `config.trivia.seasons.enabled` is `true` and a current season exists for the game
- **WHEN** `compute_answers({ game: "main" })` is called
- **THEN** `seasonStatus.currentSlug` matches the current season's slug
- **AND** `seasonStatus.isLastFireOfSeason` reflects whether today is the season's last scheduled reveal date

### Requirement: Per-fire round summary in payload

The `ProcessRevealResult` payload returned by `compute_answers` SHALL ALWAYS include a `roundSummary` field describing each player's correctness across this fire's revealed questions. It is a per-player AGGREGATE — never individual per-question responses — and is derived from the SCORED ANSWERS (the same `answers.json` source as `leaderboard`), so it is INDEPENDENT of every entry's `revealResponses` (which governs only per-question display):

```ts
roundSummary: {
  totalQuestions: number; // === reveals.length
  perPlayer: Array<{
    userId: string;
    displayName: string;
    correct: number; // count of revealed questions this player answered correctly
    answered: number; // count of revealed questions this player submitted a scored answer to (correct or incorrect)
    roundMvp?: true; // present iff this player is tied for the highest `correct` count this fire
  }>;
}
```

The field SHALL be present in EVERY reveal mode and combination of modes. `perPlayer` SHALL be empty (`[]`) only when nobody submitted a scored answer to any revealed question this fire — including when `reveals` is empty (then `totalQuestions` is `0`). A reveal entry's `revealResponses` mode SHALL NOT affect whether a player appears in `roundSummary` or their counts: a player who answered a `"just-winners"` or `"no"` question is tallied exactly as one who answered a `"yes"` question.

The scoring filter SHALL be identical to the leaderboard's: cheaters (per the question's `cheats.json`), the bot, and pending (pre-judge) freeform rows are excluded. Cheating handling is orthogonal to the reveal — cheated answers are always ignored.

`perPlayer` SHALL include only players with `answered >= 1` — players who did not answer any revealed question this fire SHALL NOT be present.

`perPlayer` SHALL be sorted by `correct` descending, ties broken by `displayName` ascending (case-insensitive, locale-sensitive comparison).

`roundMvp: true` SHALL be set on EVERY player tied for the highest `correct` value in `perPlayer`. When no player has `correct > 0`, `roundMvp` SHALL be absent from all entries.

#### Scenario: roundSummary present in every mode, computed from scored answers

- **GIVEN** a 3-question batch with modes `"yes"`, `"no"`, `"just-winners"`
- **AND** alice has a scored-correct answer on the `"yes"` and `"no"` questions, a scored-wrong answer on the `"just-winners"` question
- **WHEN** `compute_answers` returns
- **THEN** `roundSummary.totalQuestions` equals `3`
- **AND** alice has `correct: 2, answered: 3` — her `"just-winners"` and `"no"` answers count identically to a `"yes"` answer

#### Scenario: roundSummary present with empty perPlayer when nobody answered

- **GIVEN** a single revealed question that no one submitted a scored answer to
- **WHEN** `compute_answers` returns
- **THEN** the payload HAS a `roundSummary` field
- **AND** `roundSummary.totalQuestions` equals `1`
- **AND** `roundSummary.perPlayer` is `[]`

#### Scenario: Empty reveal still carries a roundSummary

- **GIVEN** no pending questions for the game
- **WHEN** `compute_answers` returns
- **THEN** `reveals` is `[]`
- **AND** `roundSummary.totalQuestions` is `0`
- **AND** `roundSummary.perPlayer` is `[]`

#### Scenario: Length-3 reveal aggregates per player

- **GIVEN** three revealed questions (any modes)
- **AND** alice answered correctly on Q1 and Q2, incorrectly on Q3
- **AND** bob answered correctly on Q1, did not answer Q2, answered correctly on Q3
- **AND** carol answered correctly on all three
- **WHEN** `compute_answers` returns
- **THEN** `roundSummary.totalQuestions` equals `3`
- **AND** alice has `correct: 2, answered: 3`
- **AND** bob has `correct: 2, answered: 2`
- **AND** carol has `correct: 3, answered: 3, roundMvp: true`
- **AND** neither alice nor bob carries `roundMvp`

#### Scenario: Player who answered zero questions is omitted

- **GIVEN** two revealed questions
- **AND** dave answered neither
- **WHEN** `compute_answers` returns
- **THEN** dave does NOT appear in `roundSummary.perPlayer`

#### Scenario: Round MVPs share the title on a tie

- **GIVEN** four players all scoring 2/3 correct on a 3-question fire
- **WHEN** `compute_answers` returns
- **THEN** all four entries in `roundSummary.perPlayer` carry `roundMvp: true`

#### Scenario: No correct answers → no MVPs

- **GIVEN** a fire where every player answered incorrectly on every question
- **WHEN** `compute_answers` returns
- **THEN** every entry in `roundSummary.perPlayer` has `correct: 0`
- **AND** no entry carries `roundMvp`

#### Scenario: Cheaters do not appear in roundSummary

- **GIVEN** a revealed question where bob answered correctly but is a flagged cheater for it
- **WHEN** `compute_answers` returns
- **THEN** bob does NOT appear in `roundSummary.perPlayer` (excluded by the same scoring filter as the leaderboard)

### Requirement: `processedAt` field on TriviaQuestion

The `TriviaQuestion` type SHALL gain an optional `processedAt?: number` field (epoch milliseconds). The field SHALL be stamped by `compute_answers` when (a) processing the oldest pending question in default mode, or (b) reprocessing a question via `reprocessQuestionIds`. Legacy rows lacking the field SHALL NOT be retroactively populated by reads — they remain `undefined` until explicitly set by a write or by a one-shot back-fill at deploy time (see migration plan in the change's design document).

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

The shared `QueryToolContext` type SHALL gain an optional `asOf?: Date` field. The cron scheduler (in `executeJob` / `executeDynamicJob`) SHALL populate it when the job is being replayed with an explicit `asOf` parameter. The `compute_answers` tool SHALL read this context value to define its effective "now" for `processedAt`-stamping and for the season-status computation. The tool's Zod argument schema SHALL NOT include an `asOf` parameter — the value is always sourced from context.

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

The introduction of `compute_answers` SHALL NOT remove the registration of any existing trivia or clack tool. `submit_answers`, `get_question_history`, `find_previous_questions`, `retrieve_scores`, and `check_season_status` SHALL remain registered with their current behavior and role tiers, available for ad-hoc admin queries. They simply leave the cron-driven reveal hot path. `fetch_channel_messages` (on the clack core MCP server) is similarly unaffected.

#### Scenario: Existing tools remain callable

- **GIVEN** the trivia plugin loaded with the new `compute_answers` tool registered
- **WHEN** Claude (in any session with sufficient role) attempts to call `submit_answers`, `get_question_history`, `find_previous_questions`, `retrieve_scores`, or `check_season_status`
- **THEN** the call resolves to the existing tool implementation with unchanged behavior

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

For freeform reveal entries in the payload produced by `compute_answers`, every entry in `voters.correct[]` and `voters.incorrect[]` SHALL carry an `answerText: string` field with the user's submitted text. `voters.fenceSitters[]` SHALL be `[]` and `voters.wildcards[]` SHALL be `[]` for freeform reveal entries (free-form has no fence-sitting or wildcard reactions by construction). Boolean and choice reveal entries' voter lists SHALL NOT gain an `answerText` field.

#### Scenario: Freeform voter entries carry answerText

- **WHEN** a freeform reveal entry is produced for a question with two correct answers ("Paris", "Paris, France") and one incorrect answer ("London")
- **THEN** `voters.correct[]` has two entries, each carrying the user's `answerText`
- **AND** `voters.incorrect[]` has one entry carrying `answerText: "London"`
- **AND** `voters.fenceSitters` is `[]` and `voters.wildcards` is `[]`

#### Scenario: Boolean reveal entry unchanged

- **WHEN** a boolean reveal entry is produced
- **THEN** voter entries do NOT carry `answerText`
- **AND** the payload shape is identical to today

### Requirement: `compute_answers` performs no Slack write

`compute_answers` SHALL NOT call any Slack write API (`chat.update`, `chat.postMessage`, `files.uploadV2`, etc.). It SHALL only read Slack message reactions as commentary signal (as today). All editing of already-posted question cards SHALL be performed by `update_answers_block` (`trivia-card-projection`). A failure to reach Slack for the reaction read SHALL degrade gracefully (empty reactions) and SHALL NOT block the scored payload.

#### Scenario: No card edit occurs during compute

- **WHEN** `compute_answers({ game })` processes a batch
- **THEN** no question's Slack message is edited by this tool
- **AND** the question cards retain their pre-reveal (interactive) state until `update_answers_block` runs

#### Scenario: Reaction-read failure does not block the payload

- **WHEN** `compute_answers` cannot fetch a message's reactions
- **THEN** the payload still returns with scored `voters` buckets and an empty `reactions` list for that entry

### Requirement: Reveal steps are atomic and independently replayable

The reveal SHALL be decomposable into steps that each do one thing and are individually safe to retry, so that an admin can re-run any single step without corrupting state. The following invariants SHALL hold:

1. **Raw inputs are never overwritten or deleted — only read.** The raw submission data in `answers.json` (button choice / chosen index / typed freeform `answerText`) is the immutable source of truth. The reveal flow derives the `correct` verdict FROM it and SHALL NOT overwrite the raw submission with the verdict, and SHALL NOT delete answer rows under ANY circumstance — the trivia data layer exposes NO answer-deletion API. Re-judging is possible only because the raw submission is retained: for freeform from the retained `answerText`, and for boolean/choice by re-deriving `correct` from the retained `answer` / `answerIndex` against the question's current key (see "Reprocess mode re-derives verdicts on retained answers").
2. **Every reveal-tool write overwrites or re-derives, never appends.** Re-running `compute_answers` on the same batch re-derives the verdict and replaces it in place; it SHALL NOT accumulate duplicate rows or double-count.
3. **`processedAt` is informational and SHALL NOT gate a reprocess.** Reprocess mode (`reprocessQuestionIds`) SHALL operate regardless of whether `processedAt` is already set.
4. **Re-judging touches only pending rows.** `compute_answers` SHALL judge a freeform submission only when its `correct` is `undefined`; rows already carrying a verdict SHALL be reused, so re-running `compute_answers` after a disclosure-mode re-stamp makes no new judge call.

#### Scenario: Re-running compute after a judge fix re-derives from retained raw text

- **GIVEN** a freeform question whose rows were scored, and the judge logic is then corrected
- **WHEN** an admin clears the affected rows' verdicts and re-runs `compute_answers` (or reprocesses the question)
- **THEN** the verdicts are re-derived from the retained `answerText` using the corrected judge
- **AND** the raw `answerText` of each row is unchanged

#### Scenario: Re-disclosure makes no new judge call

- **GIVEN** a freeform question whose rows are all already judged, re-stamped from `revealResponses: "just-correctness"` to `"yes"`
- **WHEN** `compute_answers` is re-run for that batch
- **THEN** zero `sdk.askClaude` judge calls are made (existing verdicts are reused)
- **AND** the `voters` payload now carries the `"yes"`-shaped buckets

#### Scenario: Repeated compute does not double-count

- **GIVEN** a batch already processed once by `compute_answers`
- **WHEN** the same batch is reprocessed
- **THEN** `answers.json` contains no duplicated rows for those questions and the leaderboard totals are unchanged

### Requirement: `"just-winners"` reveal-disclosure variant

The `compute_answers` payload's `voters` discriminated union SHALL support a fourth variant for questions stamped `revealResponses: "just-winners"`. This variant names the correct voters only and reduces the incorrect and no-answer voters to anonymous counts, while preserving the reactions commentary:

```ts
| { revealResponses: "just-winners";
    correct: Array<{ userId: string; displayName: string; answerText?: string }>;  // answerText present on freeform only
    incorrectCount: number;   // count of scored-wrong voters; NO names
    noAnswerCount: number;    // count of reacted-but-did-not-answer voters; NO names
    reactions: Array<{ userId: string; displayName: string; emojis: string[] }> }
```

The `incorrect` and `noAnswer` named arrays SHALL be physically absent from this variant — only the integer counts are emitted. Bot and flagged cheaters SHALL be excluded from `correct`, the counts, and `reactions`, identical to the other modes. Freeform correct voters SHALL retain their typed `answerText` (the winning answer is celebratory and about to be revealed); no incorrect or no-answer typed text SHALL ever be emitted because those voters are not named.

The `incorrectCount` SHALL equal the number of voters whose `answers.json` row scored `correct === false` (after bot/cheater exclusion); `noAnswerCount` SHALL equal the number of users who reacted but have no scored answer row (after bot/cheater exclusion).

The `"just-winners"` mode governs ONLY this per-question `voters` DISPLAY shape. It SHALL NOT suppress or alter `roundSummary`: a player who answered a `"just-winners"` question is tallied in the aggregate scoreboard exactly as for any other mode, because `roundSummary` is derived from the scored answers, not from the redacted `voters` payload.

#### Scenario: Boolean question stamped just-winners names winners and counts missers

- **GIVEN** a boolean question `Q1` stamped `revealResponses: "just-winners"` with answers `{ U1: correct, U2: wrong, U3: wrong }` and U4 reacted without answering
- **WHEN** `compute_answers` processes `Q1`
- **THEN** `reveals[0].voters.revealResponses === "just-winners"`
- **AND** `voters.correct` contains the U1 Voter
- **AND** `voters.incorrectCount === 2`
- **AND** `voters.noAnswerCount === 1`
- **AND** the variant has no `incorrect` or `noAnswer` named arrays

#### Scenario: Freeform just-winners keeps winner answerText, never misser text

- **GIVEN** a freeform question `Q2` stamped `revealResponses: "just-winners"` with rows `{ U1: "Paris" (correct), U2: "London" (wrong) }`
- **WHEN** `compute_answers` processes `Q2`
- **THEN** `voters.correct` contains a Voter for U1 carrying `answerText: "Paris"`
- **AND** `voters.incorrectCount === 1`
- **AND** no field of the payload contains the string `"London"`

#### Scenario: Everyone missed — winners bucket empty, miss count positive

- **GIVEN** a question stamped `revealResponses: "just-winners"` where every scored voter answered wrong
- **WHEN** `compute_answers` processes it
- **THEN** `voters.correct` is an empty array
- **AND** `voters.incorrectCount` equals the number of wrong voters and is greater than 0

#### Scenario: just-winners entry still contributes to roundSummary

- **GIVEN** a batch of two reveal entries, one stamped `revealResponses: "just-winners"`, where U1 answered both (correct on the just-winners one)
- **WHEN** `compute_answers` returns the payload
- **THEN** the top-level `roundSummary` field is present
- **AND** U1's `roundSummary.perPlayer` entry counts the `"just-winners"` question in both `answered` and `correct`

### Requirement: Freeform Reveal Invokes Per-Answer Judge

`compute_answers` SHALL detect any freeform questions in the batch it is about to process. For each freeform question with at least one pending `SubmittedAnswer` row (`correct === undefined`), the tool SHALL judge EACH pending submission with its OWN `sdk.askClaude` call to a small/fast Claude model (Haiku-class, default `"claude-haiku-4-5-20251001"`) — there is no single batched prompt and no echoed per-row key. Each call's prompt SHALL include the question's `statement`, `expectedAnswer`, `acceptableAnswers[]` (if any), `gradingNotes` (if any), and the single `answerText` under judgment. The tool SHALL parse a single verdict `{ correct: boolean, reason?: string }` per call and SHALL call `updateAnswer(rowKey, { correct: <verdict> })` to flip `correct` from undefined to the judged value. Per-answer calls MAY run with bounded concurrency.

When the batch contains no freeform questions, OR when every freeform question in the batch has zero pending rows, NO `sdk.askClaude` call SHALL be made.

#### Scenario: One judge call per pending submission

- **WHEN** `compute_answers` is processing a batch with two freeform questions, each with three pending answers
- **THEN** six `sdk.askClaude` calls are made, one per submission
- **AND** each call's prompt contains exactly that submission's `answerText`
- **AND** exactly six `updateAnswer` calls flip each row's `correct` from undefined to the judged value

#### Scenario: No freeform in batch — no judge call

- **WHEN** `compute_answers` is processing a batch containing only boolean and choice questions
- **THEN** zero `sdk.askClaude` calls are made
- **AND** the existing reveal flow (reaction fetch → categorize → write `SubmittedAnswer`) runs unchanged

#### Scenario: Freeform question with no submissions

- **WHEN** the batch contains a freeform question that nobody answered
- **THEN** that question contributes no judge calls
- **AND** if all freeform questions in the batch have no submissions, no `sdk.askClaude` call is made
- **AND** the reveal payload for that question reports empty `voters.correct` and `voters.incorrect` lists


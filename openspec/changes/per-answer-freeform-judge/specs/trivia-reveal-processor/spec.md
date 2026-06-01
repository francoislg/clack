## REMOVED Requirements

### Requirement: Freeform Reveal Invokes Inline Batch Judge

**Reason**: This requirement asserted a single batched `sdk.askClaude` call with echoed per-row keys ("exactly one call … six `updateAnswer`"), which is the protocol whose key-mapping produced silent `judge-missing-verdict` failures. Replaced by per-answer judging.

**Migration**: Behavior moves to the ADDED "Freeform Reveal Invokes Per-Answer Judge" requirement below; the authoritative judging contract (re-ask, never-score-a-dropped-verdict-wrong, shape-specific prompts) lives in `trivia-freeform-questions`.

## ADDED Requirements

### Requirement: Freeform Reveal Invokes Per-Answer Judge

`process_reveal_answers` SHALL detect any freeform questions in the batch it is about to process. For each freeform question with at least one pending `SubmittedAnswer` row (`correct === undefined`), the tool SHALL judge EACH pending submission with its OWN `sdk.askClaude` call to a small/fast Claude model (Haiku-class, default `"claude-haiku-4-5-20251001"`) — there is no single batched prompt and no echoed per-row key. Each call's prompt SHALL include the question's `statement`, `expectedAnswer`, `acceptableAnswers[]` (if any), `gradingNotes` (if any), and the single `answerText` under judgment. The tool SHALL parse a single verdict `{ correct: boolean, reason?: string }` per call and SHALL call `updateAnswer(rowKey, { correct: <verdict> })` to flip `correct` from undefined to the judged value. Per-answer calls MAY run with bounded concurrency.

When the batch contains no freeform questions, OR when every freeform question in the batch has zero pending rows, NO `sdk.askClaude` call SHALL be made.

#### Scenario: One judge call per pending submission

- **WHEN** `process_reveal_answers` is processing a batch with two freeform questions, each with three pending answers
- **THEN** six `sdk.askClaude` calls are made, one per submission
- **AND** each call's prompt contains exactly that submission's `answerText`
- **AND** exactly six `updateAnswer` calls flip each row's `correct` from undefined to the judged value

#### Scenario: No freeform in batch — no judge call

- **WHEN** `process_reveal_answers` is processing a batch containing only boolean and choice questions
- **THEN** zero `sdk.askClaude` calls are made
- **AND** the existing reveal flow (reaction fetch → categorize → write `SubmittedAnswer`) runs unchanged

#### Scenario: Freeform question with no submissions

- **WHEN** the batch contains a freeform question that nobody answered
- **THEN** that question contributes no judge calls
- **AND** if all freeform questions in the batch have no submissions, no `sdk.askClaude` call is made
- **AND** the reveal payload for that question reports empty `voters.correct` and `voters.incorrect` lists

## MODIFIED Requirements

### Requirement: `process_reveal_answers` MCP tool

The trivia plugin SHALL register an `admin`-tier MCP tool named `process_reveal_answers` that takes `{ game: string, reprocessQuestionIds?: string[] }` and returns a structured `ProcessRevealResult` payload. The tool SHALL absorb the deterministic work previously performed by Claude across `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers` (now removed), `retrieve_scores`, and (when seasons are enabled) `check_season_status` + `upsert_season` for the scheduled reveal flow.

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

For freeform questions, the per-answer reveal judge runs and writes verdicts into `answers.json` before the buckets are assembled.

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

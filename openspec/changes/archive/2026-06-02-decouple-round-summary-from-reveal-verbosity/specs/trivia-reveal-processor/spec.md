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

#### Scenario: roundSummary present and identical across reveal modes

- **GIVEN** a 3-question batch where slot 0 is `revealResponses: "yes"`, slot 1 is `"no"`, slot 2 is `"just-winners"`, and a player U1 has a scored answer on each
- **WHEN** `process_reveal_answers` runs and selects this batch
- **THEN** the returned payload HAS a `roundSummary` field with `totalQuestions === 3`
- **AND** `roundSummary.perPlayer` tallies U1's scored answers across ALL three questions regardless of each question's display mode

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

### Requirement: Per-fire round summary in payload

The `ProcessRevealResult` payload returned by `process_reveal_answers` SHALL ALWAYS include a `roundSummary` field describing each player's correctness across this fire's revealed questions. It is a per-player AGGREGATE — never individual per-question responses — and is derived from the SCORED ANSWERS (the same `answers.json` source as `leaderboard`), so it is INDEPENDENT of every entry's `revealResponses` (which governs only per-question display):

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
- **WHEN** `process_reveal_answers` returns
- **THEN** `roundSummary.totalQuestions` equals `3`
- **AND** alice has `correct: 2, answered: 3` — her `"just-winners"` and `"no"` answers count identically to a `"yes"` answer

#### Scenario: roundSummary present with empty perPlayer when nobody answered

- **GIVEN** a single revealed question that no one submitted a scored answer to
- **WHEN** `process_reveal_answers` returns
- **THEN** the payload HAS a `roundSummary` field
- **AND** `roundSummary.totalQuestions` equals `1`
- **AND** `roundSummary.perPlayer` is `[]`

#### Scenario: Empty reveal still carries a roundSummary

- **GIVEN** no pending questions for the game
- **WHEN** `process_reveal_answers` returns
- **THEN** `reveals` is `[]`
- **AND** `roundSummary.totalQuestions` is `0`
- **AND** `roundSummary.perPlayer` is `[]`

#### Scenario: Length-3 reveal aggregates per player

- **GIVEN** three revealed questions (any modes)
- **AND** alice answered correctly on Q1 and Q2, incorrectly on Q3
- **AND** bob answered correctly on Q1, did not answer Q2, answered correctly on Q3
- **AND** carol answered correctly on all three
- **WHEN** `process_reveal_answers` returns
- **THEN** `roundSummary.totalQuestions` equals `3`
- **AND** alice has `correct: 2, answered: 3`
- **AND** bob has `correct: 2, answered: 2`
- **AND** carol has `correct: 3, answered: 3, roundMvp: true`
- **AND** neither alice nor bob carries `roundMvp`

#### Scenario: Player who answered zero questions is omitted

- **GIVEN** two revealed questions
- **AND** dave answered neither
- **WHEN** `process_reveal_answers` returns
- **THEN** dave does NOT appear in `roundSummary.perPlayer`

#### Scenario: Round MVPs share the title on a tie

- **GIVEN** four players all scoring 2/3 correct on a 3-question fire
- **WHEN** `process_reveal_answers` returns
- **THEN** all four entries in `roundSummary.perPlayer` carry `roundMvp: true`

#### Scenario: No correct answers → no MVPs

- **GIVEN** a fire where every player answered incorrectly on every question
- **WHEN** `process_reveal_answers` returns
- **THEN** every entry in `roundSummary.perPlayer` has `correct: 0`
- **AND** no entry carries `roundMvp`

#### Scenario: Cheaters do not appear in roundSummary

- **GIVEN** a revealed question where bob answered correctly but is a flagged cheater for it
- **WHEN** `process_reveal_answers` returns
- **THEN** bob does NOT appear in `roundSummary.perPlayer` (excluded by the same scoring filter as the leaderboard)

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

The `"just-winners"` mode governs ONLY this per-question `voters` DISPLAY shape. It SHALL NOT suppress or alter `roundSummary`: a player who answered a `"just-winners"` question is tallied in the aggregate scoreboard exactly as for any other mode, because `roundSummary` is derived from the scored answers, not from the redacted `voters` payload.

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

#### Scenario: just-winners entry still contributes to roundSummary

- **GIVEN** a batch of two reveal entries, one stamped `revealResponses: "just-winners"`, where U1 answered both (correct on the just-winners one)
- **WHEN** `process_reveal_answers` returns the payload
- **THEN** the top-level `roundSummary` field is present
- **AND** U1's `roundSummary.perPlayer` entry counts the `"just-winners"` question in both `answered` and `correct`

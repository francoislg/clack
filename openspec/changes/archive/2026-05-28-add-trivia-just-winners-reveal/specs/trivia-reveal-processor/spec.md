## ADDED Requirements

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

## MODIFIED Requirements

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
    perfectRound?: true; // present iff totalQuestions >= 3 AND this player answered EVERY revealed question correctly
  }>;
}
```

The field SHALL be present in EVERY reveal mode and combination of modes. `perPlayer` SHALL be empty (`[]`) only when nobody submitted a scored answer to any revealed question this fire — including when `reveals` is empty (then `totalQuestions` is `0`). A reveal entry's `revealResponses` mode SHALL NOT affect whether a player appears in `roundSummary` or their counts: a player who answered a `"just-winners"` or `"no"` question is tallied exactly as one who answered a `"yes"` question.

The scoring filter SHALL be identical to the leaderboard's: cheaters (per the question's `cheats.json`), the bot, and pending (pre-judge) freeform rows are excluded. Cheating handling is orthogonal to the reveal — cheated answers are always ignored.

`perPlayer` SHALL include only players with `answered >= 1` — players who did not answer any revealed question this fire SHALL NOT be present.

`perPlayer` SHALL be sorted by `correct` descending, ties broken by `displayName` ascending (case-insensitive, locale-sensitive comparison).

`roundMvp: true` SHALL be set on EVERY player tied for the highest `correct` value in `perPlayer`. When no player has `correct > 0`, `roundMvp` SHALL be absent from all entries.

`perfectRound: true` SHALL be set on a player's entry IFF `roundSummary.totalQuestions >= 3` AND that player's `correct === totalQuestions` (they answered every revealed question correctly). When `totalQuestions < 3`, `perfectRound` SHALL be absent from ALL entries, regardless of any player's correctness. `perfectRound` is orthogonal to `roundMvp`: a perfect-round player is necessarily an MVP (they hold the top `correct` value), but the MVP set may include non-perfect players (e.g. a 2/3 tie) that carry `roundMvp` without `perfectRound`.

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

#### Scenario: Perfect round flagged on a 3-question sweep

- **GIVEN** a 3-question fire
- **AND** carol answered all three correctly (`correct: 3, answered: 3`)
- **AND** alice answered two of three correctly (`correct: 2, answered: 3`)
- **WHEN** `compute_answers` returns
- **THEN** carol's entry carries `perfectRound: true`
- **AND** alice's entry does NOT carry `perfectRound`

#### Scenario: Perfect round requires answering all questions, not just all attempted

- **GIVEN** a 3-question fire
- **AND** bob answered only Q1 and Q2, both correctly, and did not answer Q3 (`correct: 2, answered: 2`)
- **WHEN** `compute_answers` returns
- **THEN** bob's entry does NOT carry `perfectRound` (his `correct` of 2 is below `totalQuestions` of 3)

#### Scenario: Perfect round suppressed below the 3-question threshold

- **GIVEN** a 2-question fire
- **AND** alice answered both correctly (`correct: 2, answered: 2`)
- **WHEN** `compute_answers` returns
- **THEN** alice's entry carries `roundMvp: true`
- **AND** alice's entry does NOT carry `perfectRound`
- **AND** no entry in `roundSummary.perPlayer` carries `perfectRound`

#### Scenario: Multiple perfect players on one fire

- **GIVEN** a 4-question fire
- **AND** alice and bob each answered all four correctly
- **WHEN** `compute_answers` returns
- **THEN** both alice's and bob's entries carry `perfectRound: true` and `roundMvp: true`

## ADDED Requirements

### Requirement: Freeform Voters Flag Alternate Solves

In the `compute_answers` / `process_reveal_answers` result, each entry of a freeform question's `voters.correct[]` whose stored `judgeReason` is `alternate-solve` SHALL carry `alternateSolve: true`. Entries for answers accepted on the key SHALL NOT carry the field. The flag SHALL be present whenever the `correct` bucket itself is present for the question's `revealResponses` mode, including the mode that withholds `answerText`; it SHALL be absent when the mode exposes no correct/incorrect buckets. In teams mode, a `teamVoters.correctTeams[]` entry SHALL carry `alternateSolve: true` when any member's accepted answer was an alternate solve, plus `alternateAnswerTexts: string[]` naming those answers when the mode exposes answer text; flagged free agents keep their own flag. The tool description SHALL document these fields.

#### Scenario: Alternate solve flagged

- **WHEN** a freeform question is revealed with `revealResponses` exposing answer text, and one correct row has `judgeReason: "alternate-solve"`
- **THEN** that player's `voters.correct[]` entry carries `alternateSolve: true` alongside `answerText`

#### Scenario: On-key answer not flagged

- **WHEN** a correct row has `judgeReason: "exact-match"` or no reason
- **THEN** its `voters.correct[]` entry carries no `alternateSolve` field

#### Scenario: Flag without answer text

- **WHEN** the question's `revealResponses` mode is `"just-correctness"` and a correct row has `judgeReason: "alternate-solve"`
- **THEN** the entry carries `alternateSolve: true` and no `answerText`

#### Scenario: No buckets, no flag

- **WHEN** the question's `revealResponses` mode is `"no"`
- **THEN** the result carries no correct/incorrect voter buckets and no alternate-solve flag

#### Scenario: Team entry flags a member's alternate solve

- **WHEN** a teams-mode freeform question is revealed with answer text exposed and one member of a correct team was accepted on an alternate solve
- **THEN** that team's `correctTeams[]` entry carries `alternateSolve: true` and `alternateAnswerTexts` holding that member's answer

#### Scenario: Team entry without answer text

- **WHEN** the same question is revealed under `"just-correctness"`
- **THEN** the team entry carries `alternateSolve: true` and no `alternateAnswerTexts`

#### Scenario: Boolean and choice questions unaffected

- **WHEN** a boolean or choice question is revealed
- **THEN** no voter entry carries `alternateSolve`

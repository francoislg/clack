## ADDED Requirements

### Requirement: Exact-Match Pre-Check Bypasses the Reveal Judge

Before invoking the per-answer model judge, `judgeAnswer` SHALL run a deterministic exact-match pre-check. The pre-check SHALL normalize the player's `answerText` and compare it for equality against the normalized `expectedAnswer` and the normalized form of every entry in `acceptableAnswers` (when present). On a match, `judgeAnswer` SHALL return `{ correct: true, reason: "exact-match" }` immediately, WITHOUT calling `sdk.askClaude` and WITHOUT entering the retry loop. On no match, the answer SHALL fall through to the existing model judge path unchanged.

Normalization SHALL be maximally conservative to eliminate false-accept risk: it SHALL trim leading/trailing whitespace, lowercase the text, and collapse internal runs of whitespace to a single space. It SHALL NOT remove punctuation and SHALL NOT fold accents or other diacritics. Consequently the pre-check is a strict subset of what the model judge would accept: it can only accept answers the judge would also accept, never reject.

#### Scenario: Exact canonical answer skips the model

- **WHEN** a player's `answerText` is `"Paris"` against `expectedAnswer: "Paris"`
- **THEN** `judgeAnswer` returns `{ correct: true, reason: "exact-match" }`
- **AND** no `sdk.askClaude` call is made for that answer

#### Scenario: Case- and whitespace-insensitive match skips the model

- **WHEN** a player's `answerText` is `"  the   ROMAN empire "` against `expectedAnswer: "The Roman Empire"`
- **THEN** `judgeAnswer` returns `{ correct: true, reason: "exact-match" }`
- **AND** no `sdk.askClaude` call is made for that answer

#### Scenario: Match against an acceptable variant skips the model

- **WHEN** a player's `answerText` is `"NYC"` against `expectedAnswer: "New York City"` with `acceptableAnswers: ["NYC", "New York"]`
- **THEN** `judgeAnswer` returns `{ correct: true, reason: "exact-match" }`
- **AND** no `sdk.askClaude` call is made for that answer

#### Scenario: Non-matching answer falls through to the model judge

- **WHEN** a player's `answerText` is `"Tokyo, Japan"` against `expectedAnswer: "Tokyo"` (which the pre-check does not treat as equal)
- **THEN** the exact-match pre-check does not fire
- **AND** the answer is judged by the existing model path, which returns `correct: true` for the qualifier form as before

#### Scenario: Pre-check never folds materially-different strings together

- **WHEN** a player's `answerText` is `"C"` against `expectedAnswer: "C++"`, or `"5"` against `expectedAnswer: "$5"`, or `"cafe"` against `expectedAnswer: "café"`
- **THEN** the exact-match pre-check does not fire (punctuation and accents are not stripped)
- **AND** the answer falls through to the model judge for its decision

#### Scenario: Multi-guess hedge still rejected

- **WHEN** a player's `answerText` is `"Paris or London"` against `expectedAnswer: "Paris"`
- **THEN** the exact-match pre-check does not fire (the strings are not equal after normalization)
- **AND** the model judge returns `correct: false` with reason `multiple-guess` as before

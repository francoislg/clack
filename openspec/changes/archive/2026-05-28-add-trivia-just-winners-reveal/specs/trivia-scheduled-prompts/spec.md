## ADDED Requirements

### Requirement: Answer-reveal prompt renders the `"just-winners"` variant

The answer-reveal prompt SHALL describe a fourth `voters` discriminated-union variant keyed on `voters.revealResponses === "just-winners"`, carrying `correct` (named voters), `incorrectCount` (integer), `noAnswerCount` (integer), and `reactions`. The prompt SHALL instruct Claude to:

- Name and celebrate the `correct` voters (e.g. "<@U1> and <@U2> got it right — nice!"), quoting freeform `answerText` when present.
- Render an ANONYMOUS miss line derived from the counts (e.g. "*(3 others missed it)*") WITHOUT naming, speculating about, or implying the identity of any misser.
- When `correct` is empty and `incorrectCount > 0`, render an "everyone got fooled / nobody nailed it" closer instead of a winners line.
- Preserve the reactions commentary exactly as in the other modes.

The prompt SHALL forbid naming or guessing any incorrect or no-answer voter in this mode — the payload carries no such names. This branch SHALL apply in both the single-question and multi-question reveal layouts, and SHALL participate in the same `roundSummary`-absent / no-"This Round"-row gate as the `"just-correctness"` and `"no"` modes.

#### Scenario: Winners named, missers counted

- **WHEN** Claude renders a reveal entry whose `voters.revealResponses === "just-winners"` with `correct` containing two users and `incorrectCount: 3`
- **THEN** the rendered message names the two correct users
- **AND** includes an anonymous line reflecting that 3 others missed it
- **AND** names no incorrect or no-answer voter

#### Scenario: Nobody got it right

- **WHEN** Claude renders a `"just-winners"` entry with empty `correct` and `incorrectCount` greater than 0
- **THEN** the rendered message contains an "everyone missed it" style closer
- **AND** does not claim anyone got it right

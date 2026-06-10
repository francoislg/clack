## ADDED Requirements

### Requirement: Puzzle-quality gate

The scheduled question-generation prompt SHALL define a shared **PUZZLE QUALITY GATE** that constrains question quality across every generation path. The gate SHALL follow the same shared-definition pattern as the prompt's other gates (`DUPLICATE CHECK GATE`, `DIFFICULTY GATE`, `EMOJI SELECTION GATE`): defined exactly once and invoked from each path body by wording such as "apply the PUZZLE QUALITY GATE (shared definition above)." Every text and visual path body — fact/topical × boolean/choice/freeform — SHALL invoke the gate immediately before its `save_question` step.

The gate SHALL instruct Claude to reason explicitly (not merely assert "pass") about the question as a puzzle, evaluating at minimum five checks and revising or re-rolling on failure:

1. **Solvable by knowing, not guessing** — a knowledgeable player could reason to the answer; the question SHALL NOT reduce to a coin-flip or to recalling an isolated datum disconnected from understanding (an exact year, a raw figure, a one-off statistic). This check carries the principle of the former boolean-only `AVOID YEAR/DATE ANCHORING` block and applies it to every format.
2. **No surface tell** — stripped of its truth value, the question's phrasing, specificity, length, or confidence SHALL NOT tilt a clueless player toward the answer. The gate SHALL state the per-format manifestation inline: boolean — a true and a false framing must read equally plausible; choice — the correct option must not stand out from the distractors in length, specificity, or confidence; freeform — the prompt must not telegraph the answer.
3. **Doubt fits the difficulty** — the answer SHALL be genuinely ambiguous on the surface yet resolvable by a player with relevant knowledge and reasoning; difficulty SHALL come from that ambiguity, never from obscurity or memorization.
4. **Flavor never leaks** — surfaced non-question text (patter, subtitle, emojis, hint, alt text) SHALL NOT narrow or reveal the answer. This check reinforces the existing post-time **NO-SPOILER GATE** rather than restating it; it SHALL reference that gate, not duplicate its prose.
5. **Worth caring about** — the subject SHALL be something the audience would plausibly find interesting or relevant (for topical, genuinely salient).

The gate SHALL instruct Claude that, when a question cannot be fixed to pass, re-rolling is preferred over shipping a weak question. The check-1 principle SHALL be expressed once in this shared gate — including at least one worked example contrasting a bad isolated-datum question with a good knowledge-resolvable reframe — so it applies to choice and freeform paths as well as boolean.

#### Scenario: Gate is defined once and referenced by every path

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS`, `PREP_QUESTIONS_INSTRUCTIONS`, and `POST_QUESTIONS_INSTRUCTIONS` constants are assembled
- **THEN** they contain exactly one PUZZLE QUALITY GATE definition
- **AND** each of the six path bodies (text boolean/choice/freeform and visual boolean/choice/freeform) references that gate immediately before its `save_question` step

#### Scenario: Gate mandates explicit reasoning over a checklist

- **WHEN** the PUZZLE QUALITY GATE text is rendered into the prompt
- **THEN** it instructs Claude to reason explicitly about the question as a puzzle rather than only asserting "pass"

#### Scenario: Gate instructs re-roll over shipping a weak question

- **WHEN** the PUZZLE QUALITY GATE text is rendered into the prompt
- **THEN** it instructs Claude that re-rolling is preferred over shipping a question that cannot be fixed to pass the checks

#### Scenario: Gate forbids surface tells and unverifiable-datum questions

- **WHEN** the PUZZLE QUALITY GATE text is rendered into the prompt
- **THEN** it instructs Claude that a question stripped of its truth value must not let phrasing or specificity reveal the answer
- **AND** it instructs Claude that the answer must be solvable by knowledge and reasoning, not by recalling an isolated unverifiable datum
- **AND** the boolean-only `AVOID YEAR/DATE ANCHORING` block is no longer present as a separate boolean-path block

#### Scenario: Gate subsumes the year/date-anchoring principle with a worked example

- **WHEN** the PUZZLE QUALITY GATE text is inspected
- **THEN** it contains the "solvable by knowing, not an isolated datum" principle absorbed from the former boolean-only block
- **AND** it includes at least one worked example contrasting a bad isolated-datum question with a good knowledge-resolvable reframe

#### Scenario: Flavor-leak check defers to the existing NO-SPOILER GATE

- **WHEN** the PUZZLE QUALITY GATE's flavor check is inspected
- **THEN** it references the existing post-time NO-SPOILER GATE
- **AND** it does NOT introduce a second, duplicate body of flavor-leak prose

### Requirement: Difficulty is expressed as doubt, not obscurity

The scheduled question-generation prompt SHALL frame question difficulty as the amount of genuine doubt a knowledgeable player experiences — not as the rarity of the underlying fact. The `DIFFICULTY GATE`'s reframe levers SHALL NOT direct Claude to raise difficulty by selecting a more obscure fact; for boolean paths the levers SHALL instead adjust the plausibility of the statement (more recognizable/plausible for easier, more subtle and ambiguous-either-way for harder). The strict-membership band mechanics (`suggestedDifficultyRange` `[min, max]`, one-shot reframe, re-roll) SHALL be preserved unchanged.

#### Scenario: Boolean difficulty levers target doubt

- **WHEN** the difficulty-gate reframe levers are inspected
- **THEN** for boolean paths they instruct Claude to make the statement more or less plausibly either-way to dial difficulty
- **AND** they do NOT instruct Claude to raise boolean difficulty by choosing a more obscure fact

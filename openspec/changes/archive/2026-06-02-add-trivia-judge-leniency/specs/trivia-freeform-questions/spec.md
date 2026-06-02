## MODIFIED Requirements

### Requirement: Shape-Specific Judge Prompts

The per-answer judge's system prompt SHALL be composed of a shared core (commit-to-a-single-answer rule, the universal integrity guards — reject multi-guess, reject too-broad, reject materially-different, treat acceptable variants as additional correct, honor grading Notes — and the strict-JSON output contract), PLUS a matching-forgiveness block selected by the question's resolved `judgeLeniency` preset (see the `trivia-judge-leniency` capability), PLUS one shape rule block selected by the question's `freeformAnswerShape`. The leniency preset and the shape block are orthogonal: the preset governs how forgiving string matching is; the shape block governs value semantics for that shape.

The `date` block SHALL state that a stated tolerance window is inclusive of both endpoints and that the answer's format (bare year, decade form, explicit range) does not matter as long as the value falls in the window. The `name` / `place` / `title` block SHALL state unambiguous cross-language acceptance and its shape-specific guards (accept synonyms and reasonable variants; reject too-broad answers). Typo tolerance SHALL NOT be hardcoded in the shape block: it is contributed by the `strict-with-typos` preset (the default) and is absent under the `strict` preset. Each block SHALL omit rules irrelevant to its shape.

The resolved preset SHALL be read from the question record's `judgeLeniency` stamp, defaulting to `strict-with-typos` when the stamp is absent.

#### Scenario: Date question uses the inclusive-tolerance block

- **WHEN** the judge prompt is built for a question with `freeformAnswerShape: "date"`
- **THEN** the system prompt states the tolerance window is inclusive of both endpoints
- **AND** states that a bare year, decade form, or explicit range are all acceptable when the value is in the window

#### Scenario: Name/place/title question uses the named-entity block

- **WHEN** the judge prompt is built for a question with `freeformAnswerShape` of `name`, `place`, or `title`
- **THEN** the system prompt states unambiguous cross-language acceptance and the named-entity guards (synonyms accepted, too-broad rejected)

#### Scenario: Default preset preserves typo tolerance

- **WHEN** the judge prompt is built for a question whose resolved `judgeLeniency` is `strict-with-typos` (the default, including legacy unstamped records)
- **THEN** the matching-forgiveness block includes the minor-typo tolerance and loose-writing tolerance
- **AND** for named-entity answers (name/place/title) the effective rule set matches the pre-change default judge behavior; the same tolerance also applies to the other freeform shapes (where typo tolerance was previously absent)

#### Scenario: Strict preset omits typo tolerance

- **WHEN** the judge prompt is built for a question whose resolved `judgeLeniency` is `strict`
- **THEN** the matching-forgiveness block omits the typo tolerance
- **AND** still forgives case, numeral↔word substitution, decade form, and singular/plural variants

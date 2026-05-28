## ADDED Requirements

### Requirement: revealResponses cascade accepts `"just-winners"`

The `revealResponses` cascade resolved and stamped at `post_questions` time SHALL accept `"just-winners"` as a valid value at every tier (`slot → season → game → workspace`). When `"just-winners"` is the highest-precedence defined value, `post_questions` SHALL stamp `revealResponses: "just-winners"` onto the question record in the same atomic write used for the existing modes. No re-resolution occurs at reveal time.

#### Scenario: just-winners workspace default is stamped

- **GIVEN** `config.trivia.revealResponses: "just-winners"`, with no game / season / slot override, and `Q1` belongs to the active batch
- **WHEN** `post_questions` posts `Q1`
- **THEN** the question record is updated with `revealResponses: "just-winners"`

#### Scenario: just-winners slot override wins the cascade

- **GIVEN** a slot stamped `revealResponses: "just-winners"` over a season default of `"yes"`
- **WHEN** `post_questions` posts that slot's question
- **THEN** the stamped value is `"just-winners"`

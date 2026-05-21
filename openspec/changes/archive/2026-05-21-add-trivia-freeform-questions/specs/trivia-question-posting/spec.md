## ADDED Requirements

### Requirement: Freeform Question Card Includes Answer Button

When `post_questions` posts a question whose `answersFormat === "freeform"`, the posted Block Kit payload SHALL include a Slack `actions` block containing exactly one button with:

- `text`: literal `"Answer"`
- `style`: `"primary"`
- `action_id`: `"plugin:trivia:freeform-answer:<questionId>"` (the `plugin:trivia:` prefix is the plugin-interactivity SDK's namespacing convention; the `freeform-answer:` segment is the trivia plugin's local action key; `<questionId>` is the question record's id and lets the action handler resolve the target question)

The button SHALL appear directly below the question statement and category emojis.

#### Scenario: Freeform card carries the button

- **WHEN** `post_questions` posts a freeform question with `id: "q-abc"`
- **THEN** the posted message's blocks include an `actions` block with one button: `{ text: "Answer", action_id: "plugin:trivia:freeform-answer:q-abc" }`

#### Scenario: Boolean and choice cards unaffected

- **WHEN** `post_questions` posts a boolean or choice question
- **THEN** no `Answer` button is added to the message
- **AND** the existing vote-reaction seeding runs as before

### Requirement: Freeform Questions Are Posted Without Reactions

When `post_questions` posts a freeform question, the reaction-derivation step SHALL produce an empty list and the tool SHALL skip the `addDeliveryReactions` call entirely. No `+1`/`-1` reactions and no numeric (`one`/`two`/`three`/`four`) reactions SHALL be seeded on freeform messages.

#### Scenario: Freeform card has no reactions

- **WHEN** `post_questions` posts a freeform question
- **THEN** the per-question result's `reactions` (if returned) is `[]`
- **AND** no `reactions.add` Slack call is made for the question's message

#### Scenario: deriveReactions returns empty for freeform

- **WHEN** the internal `deriveReactions(question)` helper is invoked on a freeform question
- **THEN** it returns `[]`
- **AND** is consistent for both `answersFormat: "freeform"` records with or without `acceptableAnswers` populated

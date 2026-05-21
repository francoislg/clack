## ADDED Requirements

### Requirement: Six-Way Generation Matrix

The scheduled question-posting prompt SHALL dispatch on the cross product of `suggestedAnswersFormat × suggestedQuestionType`, where `suggestedAnswersFormat ∈ { "boolean", "choice", "freeform" }` and `suggestedQuestionType ∈ { "fact", "topical" }`, producing six explicit generation paths:

```
              boolean             choice              freeform
fact     │ BOOLEAN_FACT      │ CHOICE_FACT       │ FREEFORM_FACT       │
topical  │ BOOLEAN_TOPICAL   │ CHOICE_TOPICAL    │ FREEFORM_TOPICAL    │
```

The two freeform paths (`FREEFORM_FACT_FLOW_STEPS`, `FREEFORM_TOPICAL_FLOW_STEPS`) SHALL instruct Claude to:

1. Write the question's `statement` in the same plain-statement style as boolean/choice paths.
2. Write the canonical `expectedAnswer: string` — the shortest correct form Claude would accept as a 100%-perfect answer.
3. OPTIONALLY enumerate `acceptableAnswers: string[]` — semantic variants and reasonable rephrasings Claude would also accept (e.g. canonical-plus-common-forms).
4. OPTIONALLY add `gradingNotes: string` — a one-sentence hint to the reveal-time judge about acceptable answer forms or specific judging considerations.
5. Call `save_question` with `answersFormat: "freeform"` plus the fields above (and the existing common fields: `questionType`, `category`, `emojis`, etc.).

The `FREEFORM_TOPICAL_FLOW_STEPS` path SHALL additionally run the same WebSearch research step and `sourceUrl` capture as the existing `BOOLEAN_TOPICAL` and `CHOICE_TOPICAL` paths — descending through `contextPriority` the same way.

#### Scenario: Fact-freeform dispatch

- **WHEN** `get_ideas` rolls `suggestedAnswersFormat: "freeform"` and `suggestedQuestionType: "fact"`
- **THEN** the scheduled prompt routes to `FREEFORM_FACT_FLOW_STEPS`
- **AND** the path does NOT invoke `WebSearch`
- **AND** the path's `save_question` instruction passes `answersFormat: "freeform"`

#### Scenario: Topical-freeform dispatch

- **WHEN** `get_ideas` rolls `suggestedAnswersFormat: "freeform"` and `suggestedQuestionType: "topical"`
- **THEN** the scheduled prompt routes to `FREEFORM_TOPICAL_FLOW_STEPS`
- **AND** the path runs the same WebSearch research step + `contextPriority` descent as other topical paths
- **AND** the saved question carries `sourceUrl` (required), optional `eventDate`, and the freeform fields (`expectedAnswer`, optionally `acceptableAnswers` / `gradingNotes`)

#### Scenario: Non-freeform dispatch unchanged

- **WHEN** `get_ideas` rolls `suggestedAnswersFormat: "boolean"` or `"choice"`
- **THEN** the dispatch chooses the existing `BOOLEAN_*` or `CHOICE_*` path as before
- **AND** no freeform-specific instruction is included in the prompt

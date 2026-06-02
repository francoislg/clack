## ADDED Requirements

### Requirement: Emoji selection non-spoiler gate

The scheduled question-generation prompt SHALL define a shared **EMOJI SELECTION GATE** that constrains the `emojis` field so it never reveals the answer. The gate SHALL follow the same shared-definition pattern as the prompt's other gates (`DUPLICATE CHECK GATE`, `DIFFICULTY GATE`, `STATEMENT–CHOICES NON-OVERLAP GATE`, `HINT DRAFTING GATE`): defined once and invoked from each generation path by wording such as "apply the EMOJI SELECTION GATE (shared definition above)."

The gate SHALL instruct Claude that the per-question `emojis` decorate the **category** (the card title renders `<emoji> <Category>`), and SHALL forbid any emoji that depicts the answer or the question's specific subject — e.g. a country-flag emoji on a question about that country's flag, an animal emoji whose species is the answer, or a landmark emoji that identifies the answer. When a topic-literal emoji would leak the answer, the gate SHALL direct Claude to fall back to a category-level or generic emoji (e.g. 🌍/🏳️ for a geography/flag question, not 🇪🇨). This mirrors the non-spoiler treatment already required for `media.altText` on visual questions.

Every emoji-selection step across all generation paths — fact boolean, fact choice, fact freeform, and the visual choice/boolean/freeform paths — SHALL invoke this gate in place of free-form "choose emojis relating to the topic" wording.

#### Scenario: Gate is defined once and referenced by every path

- **WHEN** `SEND_QUESTIONS_INSTRUCTIONS` (and the staged-prep / post prompts that share the per-slot generation blocks) is assembled
- **THEN** it contains exactly one EMOJI SELECTION GATE definition
- **AND** each of the six emoji-selection steps (fact boolean, fact choice, fact freeform, visual choice, visual boolean, visual freeform) references that gate rather than instructing Claude to "choose emojis relating to the topic" directly

#### Scenario: Gate forbids answer-revealing emojis

- **WHEN** the EMOJI SELECTION GATE text is rendered into the prompt
- **THEN** it instructs Claude that emojis decorate the category, not the answer
- **AND** it forbids emojis that depict the answer or the question's specific subject (e.g. a country-flag emoji on a flag question)
- **AND** it directs Claude to fall back to a category-level or generic emoji when a topic-literal emoji would leak the answer

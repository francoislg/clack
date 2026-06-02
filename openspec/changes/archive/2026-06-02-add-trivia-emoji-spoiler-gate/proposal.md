## Why

Trivia question cards render the per-question `emojis` field into the card title at question time (`<emoji> <Category>`), but the generation prompt only tells Claude to "Choose emojis relating to the topic." That instruction pulls Claude toward topic-literal emojis that leak the answer — 🇪🇨 on "what colors are on Ecuador's flag", 🐆 on "the fastest land animal", 🛑 on "how many sides does a stop sign have". The spoiler is visible before anyone votes. The visual paths already enforce the same non-spoiler logic for `media.altText` ("a national flag", not "the flag of Ecuador"); the `emojis` field beside it never got the parallel constraint.

## What Changes

- Add a shared **EMOJI SELECTION GATE** to `src/plugins/trivia/prompts/scheduledPrompts.ts`, following the existing shared-gate pattern (`DUPLICATE CHECK GATE`, `DIFFICULTY GATE`, `STATEMENT–CHOICES NON-OVERLAP GATE`, `HINT DRAFTING GATE`). The gate anchors emojis to the **category** (the text the emoji decorates), and forbids emojis that depict the answer or the question's specific subject.
- Route all six emoji-selection steps through the gate: fact boolean/choice/freeform and visual choice/boolean/freeform. Each step's "Choose emojis relating to the topic" wording is replaced with "apply the EMOJI SELECTION GATE (shared definition above)."
- Prompt-only change. No new tools, no `save_question` validation, no data-model change. Emoji selection stays Claude's call; the gate just constrains it.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-scheduled-prompts`: the emoji-selection step in the question-generation flow gains a non-spoiler constraint — emojis SHALL relate to the category, not the answer or the question's specific subject — expressed as a shared gate referenced by every generation path.

## Impact

- `src/plugins/trivia/prompts/scheduledPrompts.ts` — add the gate constant; update the six emoji-selection steps to reference it.
- Tests under `src/plugins/trivia/prompts/` (`scheduledPrompts.test.ts`, `scheduledPrompts.choice.test.ts`, `scheduledPrompts.visual.test.ts`) — assert the gate text is present and referenced by each path.
- No runtime, schema, or stored-record changes. Existing questions and posted cards are unaffected.

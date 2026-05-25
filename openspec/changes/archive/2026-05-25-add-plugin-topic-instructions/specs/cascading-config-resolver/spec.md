## ADDED Requirements

### Requirement: buildVirtualDefaults Routes Topic-Scoped Keys

The plugin virtual-defaults aggregator (`buildVirtualDefaults` in `src/instructions.ts`) SHALL accept topic-scoped instruction entries from plugins. An entry whose `filename` (as stored on the plugin load result) begins with `topics/<topic>/` SHALL be inserted into the resulting `VirtualDefaults` map under the same prefixed key, so that the existing `resolveTopicFiles` function picks it up when the topic is active.

Plugin entries without the `topics/` prefix SHALL continue to be inserted as baseline virtual defaults, exactly as today.

#### Scenario: Topic-prefixed virtual default routed into topic resolution

- **GIVEN** the trivia plugin registers an instruction with role `"user"` and stored filename `"topics/trivia/trivia__persona.md"` and some content
- **WHEN** `buildVirtualDefaults()` is called during prompt assembly
- **THEN** the resulting `VirtualDefaults` map contains an entry at `"user" → "topics/trivia/trivia__persona.md" → <content>`
- **AND** when `resolveInstructions(["user"], new Set(["trivia"]), virtualDefaults)` is called, the topic section includes the content

#### Scenario: Baseline virtual default unaffected

- **GIVEN** the trivia plugin registers an instruction with role `"user"` and stored filename `"trivia__trivia-check.md"` (no `topics/` prefix)
- **WHEN** `buildVirtualDefaults()` is called
- **THEN** the resulting `VirtualDefaults` map contains an entry at `"user" → "trivia__trivia-check.md" → <content>`
- **AND** the baseline cascade picks up the file as before
- **AND** the topic resolver does NOT include the file in any topic section

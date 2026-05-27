## ADDED Requirements

### Requirement: `instructions` and `additionalInstructions` fields on TriviaGame and TriviaConfig

The `TriviaConfig` type (workspace tier) and the `TriviaGame` type (per-game tier) SHALL each support two new OPTIONAL string fields: `instructions` and `additionalInstructions`. Both fields cascade per the rules defined in `trivia-prompt-instructions`. Both fields MUST be parsed with the lenient drop-on-invalid policy already used for `theme` — a malformed value drops that field and logs an issue without rejecting the surrounding entry.

#### Scenario: TriviaGame carries both fields independently

- **WHEN** `data/plugins/trivia/config.json` declares `games: [{ name: "main", channel: "C…", …, instructions: "Be dry.", additionalInstructions: "Avoid politics." }]`
- **THEN** the parsed in-memory `TriviaGame` SHALL carry both fields with the trimmed string values

#### Scenario: TriviaConfig (workspace tier) carries both fields

- **WHEN** the trivia config's top-level object declares `instructions: "Be funny."` and `additionalInstructions: "Keep it kid-friendly."`
- **THEN** the parsed `TriviaConfig` SHALL carry both fields with the trimmed string values

#### Scenario: Whitespace-only field drops with a logged issue

- **WHEN** a game entry declares `instructions: "   "` (whitespace only)
- **THEN** the parser SHALL drop the `instructions` field on that entry, log an issue against `trivia.games[<i>].instructions`, AND retain every other valid field on the entry

#### Scenario: Non-string field drops with a logged issue

- **WHEN** a game entry declares `instructions: 42` (number)
- **THEN** the parser SHALL drop the `instructions` field on that entry, log an issue against `trivia.games[<i>].instructions`, AND retain every other valid field on the entry

#### Scenario: Fields are independently optional

- **WHEN** a game entry sets `instructions` but not `additionalInstructions` (or vice versa)
- **THEN** the parsed entry SHALL include only the field that was set, with the other absent

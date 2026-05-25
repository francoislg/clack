## MODIFIED Requirements

### Requirement: list_seasons tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `list_seasons` MCP tool gated to the `admin` role that returns every entry on a specified game's timeline with full details, including each season's explicitly-set axis configuration so admins can audit the cascade without reading the seasons.json file by hand.

The tool SHALL accept a required `game: string` argument validated against `config.trivia.games[]`. Read tool — succeeds against `enabled: false` games. The tool's analysis SHALL be scoped exclusively to `data/plugins/trivia/games/<game>/seasons.json` (lazy-seeded if missing).

The return shape SHALL be:

```
{
  game: string,
  seasons: Array<{
    slug: string,
    startedAt: number,
    expectedEndAt: number,
    endedAt: number | null,
    categories: string[],
    status: "past" | "current" | "future",
    theme?: string,
    answersFormat?: TriviaAnswersFormatWeights,
    questionType?: TriviaQuestionTypeWeights,
    freeformAnswerShape?: TriviaFreeformAnswerShapeWeights,
    contexts?: TriviaContextEntry[],
    difficulty?: TriviaDifficultyConfig,
    format?: {
      questions: Array<{
        label?: string,
        categories?: string[],
        answersFormat?: TriviaAnswersFormatWeights,
        questionType?: TriviaQuestionTypeWeights,
        freeformAnswerShape?: TriviaFreeformAnswerShapeWeights,
        contexts?: TriviaContextEntry[],
        difficulty?: TriviaDifficultyConfig
      }>
    }
  }>,
  total: number
}
```

The `status` field is derived per entry against `Date.now()`:

- `"future"` when `startedAt > now`
- `"past"` when `(endedAt ?? expectedEndAt) <= now`
- `"current"` otherwise

The `theme`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, and `format` fields SHALL be present on a season entry IF AND ONLY IF the season's stored record carries an explicit value for that field. Absent fields signal that the season relies on the next tier of the cascade (workspace defaults or built-in fallback). Slot entries inside `format.questions` follow the same rule — each slot-tier field is present only when the slot literally set it.

Entries SHALL be returned in their stored order. The full `categories` array is included for every entry. The tool's description SHALL explicitly state the cascade rule (slot → season → workspace → built-in default) and point Claude at `list_games` for the workspace tier, so the response can be reasoned about without out-of-band knowledge.

#### Scenario: Returns every timeline entry for the named game with status flags

- **GIVEN** `games/main/seasons.json` contains a past season, the active season, and a queued future season
- **WHEN** `list_seasons` is invoked with `game: "main"`
- **THEN** the response includes all three entries from the `main` timeline
- **AND** the past entry's `status` is `"past"`
- **AND** the active entry's `status` is `"current"`
- **AND** the future entry's `status` is `"future"`
- **AND** each entry includes its full `categories` array
- **AND** no entries from `games/sandbox/seasons.json` appear in the response

#### Scenario: Season-tier axis values are surfaced when set

- **GIVEN** the active season has `freeformAnswerShape: { name: 3, number: 0, ...others: 1 }` explicitly stored on its entry, no `questionType` set, and no `format`
- **WHEN** `list_seasons` is invoked
- **THEN** that entry's `freeformAnswerShape` matches the stored value exactly
- **AND** the entry has no `questionType` field
- **AND** the entry has no `format` field

#### Scenario: Slot-tier axis values inside format.questions are surfaced when set

- **GIVEN** the active season has `format: { questions: [{}, { label: "Lightning", freeformAnswerShape: { name: 1, place: 0, phrase: 0, title: 0, date: 0, number: 0, other: 0 } }] }`
- **WHEN** `list_seasons` is invoked
- **THEN** `format.questions[0]` has no axis fields (slot 0 overrides nothing)
- **AND** `format.questions[1].label === "Lightning"`
- **AND** `format.questions[1].freeformAnswerShape` matches the stored value
- **AND** `format.questions[1]` has no `answersFormat` / `questionType` / `contexts` / `difficulty` fields (slot 1 only set freeformAnswerShape)

#### Scenario: theme is surfaced when set, absent when not

- **GIVEN** one season has `theme: "Halloween Spooktacular"` and another has no theme
- **WHEN** `list_seasons` is invoked
- **THEN** the themed entry has `theme: "Halloween Spooktacular"`
- **AND** the non-themed entry has no `theme` field

#### Scenario: Lazy-seed happens when seasons.json missing

- **GIVEN** `games/main/seasons.json` is missing and `trivia.seasons.enabled` is `true`
- **WHEN** `list_seasons` is invoked with `game: "main"`
- **THEN** the lazy-seed runs and creates `games/main/seasons.json` with a starter entry
- **AND** the response includes that one starter entry

#### Scenario: Unknown game rejected

- **WHEN** `list_seasons` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `list_seasons` is absent from the session's MCP catalog

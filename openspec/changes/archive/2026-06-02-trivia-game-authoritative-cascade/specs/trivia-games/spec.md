## ADDED Requirements

### Requirement: Per-slot axis overrides resolve from the effective format

Per-slot cascade-axis overrides SHALL be read from the EFFECTIVE format — `season.format` when the active season defines one, otherwise `game.format` — for ALL cascading axes, consistent with how per-slot `categories`/`label` and the post-time axes (`liveAnswersVisible`/`revealResponses`) already resolve. The `CascadeContext.slot` tier SHALL be constructed by a single shared helper used by `get_ideas`, `post_questions`, and `explain_cascade`, so all three resolve the slot tier identically. When a season format is active it REPLACES the game format (the existing effective-format model is unchanged); game-format slots contribute only when no season format is active.

#### Scenario: Game-format slot axis override takes effect

- **WHEN** no season format is active, a game defines `format.questions[0].answersFormat`, and `get_ideas` resolves slot 0
- **THEN** the slot's `answersFormat` override wins (tier `slot`), instead of being ignored

#### Scenario: Season format still wins when present

- **WHEN** an active season defines a `format` and the game also defines one
- **THEN** the slot tier resolves from the season's format slots, and the game's format slots do not contribute

#### Scenario: All three consumers agree on the slot tier

- **WHEN** `get_ideas`, `post_questions`, and `explain_cascade` build a context for the same `(game, slot)`
- **THEN** they produce the same `slot` tier object via the shared `buildCascadeContext` helper

#### Scenario: Out-of-range slot index yields no slot tier

- **WHEN** a slot index is not present in the effective format (or no format is active)
- **THEN** the `slot` tier is `null` and resolution proceeds from season → game → workspace → default (the tools' existing range validation rejects an explicit out-of-range `slot` argument before resolution)

### Requirement: upsert_game surfaces cascade shadowing

`upsert_game` writes the GAME tier, so a written field is "shadowed" when the cascade's winning tier for that field is strictly ABOVE `game` — the active `season`, or (for a game that has its own `format`) a per-`slot` override that masks the game's top-level value. When any written field (a cascading axis or the `format` pseudo-field) is shadowed, the tool SHALL include a `shadowedBy` object in its result: `{ tier: "season" | "slot", slug?: string, fields: string[] }`. `fields` SHALL be a string array of the shadowed field names, with `"format"` appearing as a string pseudo-field entry (resolved via `resolveEffectiveFormat`, not the axis registry); `slug` is present only for `tier: "season"`. The tool SHALL only DETECT and REPORT shadowing — it SHALL NOT mutate the season. When no written field is shadowed, `shadowedBy` is omitted.

#### Scenario: Season-shadowed game edit is reported

- **WHEN** an active season sets `answersFormat` and an admin calls `upsert_game(name, { answersFormat })`
- **THEN** the result includes `shadowedBy: { tier: "season", slug, fields: ["answersFormat"] }`

#### Scenario: Format shadowing is reported as a string pseudo-field

- **WHEN** an active season defines a `format` and an admin calls `upsert_game(name, { answersFormat, format })` with both shadowed
- **THEN** `shadowedBy.fields` is the string array `["answersFormat", "format"]` (not a nested object)

#### Scenario: A game's own format slot shadows its top-level axis

- **WHEN** no season is active, a game has a `format` whose slot overrides `answersFormat`, and an admin calls `upsert_game(name, { answersFormat })`
- **THEN** the result reports `shadowedBy: { tier: "slot", fields: ["answersFormat"] }` (no `slug`)

#### Scenario: No active season and no masking slot reports nothing

- **WHEN** the timeline is in a gap (no active season) and no game-format slot overrides the written field
- **THEN** `shadowedBy` is omitted

#### Scenario: Unshadowed edit reports nothing

- **WHEN** an admin edits a game field that no higher tier overrides
- **THEN** the result omits `shadowedBy`

### Requirement: Game-authoritative write default

The admin management instruction SHALL direct that game configuration edits default to the GAME tier (`upsert_game` / `set_workspace_config`), and that a season override (`upsert_season`) is written ONLY when the admin explicitly scopes a change to the current or a specific season. When a game edit is shadowed by an active season, the instruction SHALL direct Claude to surface the shadow and offer to apply the change to the current season too (per the trivia-seasons clear-to-inherit behavior).

#### Scenario: Default edit targets the game

- **WHEN** an admin says "make this game's questions harder" with no season qualifier
- **THEN** Claude edits the game tier (`upsert_game`), not the active season

#### Scenario: Explicit season scope targets the season

- **WHEN** an admin says "for THIS season, switch to image questions"
- **THEN** Claude writes the season override (`upsert_season`)

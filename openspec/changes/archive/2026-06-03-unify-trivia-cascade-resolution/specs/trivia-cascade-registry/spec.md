## MODIFIED Requirements

### Requirement: Generic cascade resolver reports value and winning tier

The plugin SHALL provide a generic `resolveCascade(key, ctx)` function that walks the fixed order **`seasonSlot → season → gameSlot → game → workspace → built-in default`**, returns the first-defined value, and reports the **winning tier** plus the per-tier ladder. The slot tier is split into two concrete tiers: `gameSlot` (from `game.format.questions[i]`) is the authoritative per-question **base**, and `seasonSlot` (the season's per-slot override for index `i`) is the **override** that wins over it. `buildCascadeContext` SHALL populate both `ctx.gameSlot` and `ctx.seasonSlot`; neither is re-derived from `season.format` inside any resolver.

The same `resolveCascade` function SHALL be the single resolution path used by **`get_ideas` (including the `freeformAnswerShape` roll), `save_question`, `post_questions`, `process_reveal_answers`, and every audit surface (`explain_cascade`)**. No consumer SHALL call a per-axis legacy resolver. Therefore the resolved value and its provenance are computed by one code path for generation, validation, posting, reveal, and audit alike.

#### Scenario: First-defined tier wins and is reported

- **WHEN** an axis is set at the game tier and unset at `seasonSlot`, `season`, and `gameSlot` for a given `(game, slot)`
- **THEN** `resolveCascade` returns the game-tier value
- **AND** reports `tier: "game"`

#### Scenario: Game slot is the base and resolves with no active season format

- **WHEN** a game defines a `format` whose slot `i` sets an axis (e.g. `answersFormat`), no season is active OR the active season provides no override for slot `i`
- **THEN** `resolveCascade` returns the game slot's value
- **AND** reports `tier: "gameSlot"`

#### Scenario: Season slot overrides the game slot

- **WHEN** both `gameSlot[i]` and `seasonSlot[i]` define the same axis
- **THEN** `resolveCascade` returns the `seasonSlot` value
- **AND** reports `tier: "seasonSlot"`

#### Scenario: Resolution falls through to default

- **WHEN** an axis is unset at `seasonSlot`, `season`, `gameSlot`, `game`, and `workspace`
- **THEN** `resolveCascade` returns the registry `default`
- **AND** reports `tier: "default"`

#### Scenario: Generation and audit agree (generation axes)

- **WHEN** `get_ideas` rolls an axis and `explain_cascade` reports the same `(game, slot)` axis
- **THEN** the value `get_ideas` resolved equals the `value` `explain_cascade` reports for that axis and tier
- **AND** this holds for `freeformAnswerShape`, which `get_ideas` resolves via `resolveCascade` (not via the answer-type handler)

#### Scenario: Validation and audit agree (save_question axes)

- **WHEN** `save_question` validates `answersFormat`, `questionType`, `contexts`, or `judgeLeniency` for a `(game, slot)` and `explain_cascade` reports the same coordinate
- **THEN** both resolve to the identical value and tier, because both call `resolveCascade`

#### Scenario: Reveal and audit agree (instruction axes)

- **WHEN** `process_reveal_answers` resolves `instructions` or `additionalInstructions` for a coordinate and `explain_cascade` reports the same coordinate
- **THEN** both resolve to the identical value, because both call `resolveCascade`

### Requirement: Custom-resolution axes remain registry-enforced

Axes whose resolution is not pure first-defined-tier-wins SHALL be declared in `AXIS_REGISTRY` with `kind: "custom"` and a bespoke resolver that returns the same `{ value, tier, ladder }` shape. The compiler SHALL still require their presence in the registry. The custom axes are:

- `difficulty` — merges per-field within a tier and is keyed by `answersFormat`.
- `difficultyRatio` — keyed by `answersFormat`.
- `additionalInstructions` — **cumulative**: it concatenates every contributing tier's value rather than selecting one.

A custom resolver SHALL compute its `value` from the same context tier objects (`ctx.seasonSlot`, `ctx.season`, `ctx.gameSlot`, `ctx.game`, `ctx.config`) that its `ladder` iterates — so the returned `value` and the reported `tier`/`ladder` can never disagree. No custom resolver SHALL re-derive the slot from `season.format`.

Because a custom axis can draw its result from more than one tier, the `tier` field SHALL report `"merged"` when the resolved value was assembled from more than one tier, and the single contributing tier otherwise. When `"merged"` is reported, the `ladder` SHALL show which tier supplied each part. The `CascadeTier` type SHALL include `"merged"`, `"seasonSlot"`, and `"gameSlot"`.

#### Scenario: difficulty stays compiler-required

- **WHEN** `difficulty` is omitted from `AXIS_REGISTRY`
- **THEN** `npx tsc` fails because the registry no longer satisfies `Record<keyof CascadeAxes, AxisDef>`

#### Scenario: Custom resolver value matches its reported tier

- **WHEN** `resolveCascade("difficulty", ctx)` runs for a coordinate where the game slot supplies a field the season slot does not
- **THEN** the returned `value` includes the game slot's field
- **AND** the `ladder` attributes that field to `gameSlot` (the value cannot claim a tier the ladder did not report)

#### Scenario: Custom resolver reports merged provenance across slot tiers

- **WHEN** `resolveCascade("difficulty", ctx)` draws one range from `seasonSlot` and another from `gameSlot`
- **THEN** it returns the merged value with `tier: "merged"`
- **AND** the `ladder` identifies which slot tier supplied each field

### Requirement: Cascade resolution has a single implementation

The plugin SHALL resolve every cascade axis through `resolveCascade` and SHALL NOT retain any parallel per-axis resolver. As part of this change the legacy resolvers `resolveAnswersFormat`, `resolveQuestionType`, `resolvePromptMedium`, `resolveFreeformAnswerShape`, `resolveContexts`, `resolveJudgeLeniency`, `resolveHintConfig`, `resolveInstructions`, and `resolveAdditionalInstructions` SHALL be removed, and the slot-re-deriving bodies of `resolveDifficultyRanges` / `resolveDifficultyRatio` SHALL be folded into the custom resolvers — no standalone resolver that re-derives the slot from `season.format` SHALL remain. `resolveEffectiveFormat` is retained solely for format count/structure and slot-list sourcing, never for axis resolution.

#### Scenario: No legacy per-axis resolver remains

- **WHEN** the trivia `domain/` is inspected (e.g. a structural test or lint guard over `src/plugins/trivia/domain`)
- **THEN** none of the named legacy per-axis resolvers is exported or defined
- **AND** no resolver re-derives a slot via `currentSeason.format.questions[...]` outside `buildCascadeContext` / `resolveEffectiveFormat`

#### Scenario: Adding a consumer cannot reintroduce a bypass

- **WHEN** a new consumer needs a cascade axis value
- **THEN** the only resolution function available to import is `resolveCascade` (no per-axis resolver exists to call)

### Requirement: Resolution outcomes follow the game-base / season-override model

The cascade SHALL resolve the slot tier as **game-base, season-override**: a game's `format` slot is the authoritative per-question base, and a season layers sparse overrides on top (`seasonSlot` wins over `gameSlot`). A game-format slot's axis overrides SHALL take effect during generation (`get_ideas`) and validation (`save_question`) whether or not a season is active. Characterization tests over a representative matrix (seasons on/off, game format present/absent, season overrides present/absent, overrides at each tier) SHALL assert this model and SHALL include the previously-broken case: a game-format slot with overrides and NO active season resolves to the game slot's values, not the registry defaults.

This requirement SUPERSEDES the prior "refactor preserves all outcomes" requirement: the game-base/season-override model deliberately changes resolved outcomes for the case where a game defines a format (previously its slot overrides were dropped).

#### Scenario: Game-format slot override is honored with no active season

- **WHEN** a game defines a 3-slot `format` with slot 2 set to `answersFormat: { freeform: 1 }`, seasons are off (or no season is active), and slot 2 is generated
- **THEN** `get_ideas` rolls `answersFormat = "freeform"` for slot 2
- **AND** `explain_cascade({ game, slot: 2 })` reports `answersFormat` value `{ freeform: 1 }` at `tier: "gameSlot"`

#### Scenario: Question count is the game's unless the season overrides it

- **WHEN** a game defines a 3-slot `format` and the active season provides only `slotOverrides` (no structural format of its own)
- **THEN** each fire posts 3 questions
- **AND** the season's `slotOverrides` change only the addressed slots' fields, not the count

### Requirement: Project documentation describes the unified cascade

The project's `CLAUDE.md` "Trivia cascade registry" section SHALL document the cascade as the 6-tier walk **`seasonSlot → season → gameSlot → game → workspace → built-in default`** under the game-base / season-override model, and SHALL describe season `slotOverrides` and the single-resolution-path guarantee across all five consumers (`get_ideas`, `save_question`, `post_questions`, `process_reveal_answers`, `explain_cascade`). It SHALL NOT retain the prior description of the slot tier reading the "effective format" (`season.format ?? game.format`).

#### Scenario: Documentation matches the implemented model

- **WHEN** `CLAUDE.md`'s trivia cascade section is read after this change ships
- **THEN** it states the 6-tier walk and the game-base/season-override model
- **AND** it does not describe a single merged `slot` tier sourced from `resolveEffectiveFormat`

# trivia-cascade-registry Specification

## Purpose
TBD - created by archiving change add-trivia-cascade-registry-and-explain. Update Purpose after archive.
## Requirements
### Requirement: Single CascadeAxes definition is the source of truth

The Trivia plugin SHALL define every cascading axis exactly once in a `CascadeAxes` interface (`src/plugins/trivia/core/cascadeAxes.ts`). Every cascade tier type — `TriviaGame`, `SeasonEntry`, `SeasonFormatSlot`, and `TriviaConfig` (the workspace tier) — SHALL extend `CascadeAxes` so that all tiers share the identical axis field set keyed by `keyof CascadeAxes`.

**Membership rule.** A field SHALL be a `CascadeAxes` member if and only if it resolves through the **per-question cascade** — i.e. it participates in the slot/season tiers, not merely game+workspace. The members are: the weighted axes (`answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`), the flat axes (`hint`, `judgeLeniency`, `choices`), the string axes (`instructions`, `additionalInstructions`), and the post-time axes (`liveAnswersVisible`, `revealResponses`). Membership is independent of WHEN the axis is consumed: `liveAnswersVisible` and `revealResponses` are resolved at post time (`core/liveAnswersResolver.ts`, `core/revealResponsesResolver.ts`) but are 4-tier first-wins cascades and SHALL be members; `choices` is a `{ min, max }` first-wins bound consumed by both the `get_ideas` choice-count roll and `save_question` length validation.

`CascadeAxes` SHALL NOT contain:

- plain identity fields (`name`, `channel`, cron expressions, `timezone`, `enabled`);
- the **structural-special** cascading fields `format`, `categories`, and `theme`, which keep bespoke cascade semantics (slot composition, category-pool resolution, narrative-label resolution);
- **`allTimeRow`**, which resolves only `game → workspace → default` and never touches the per-question (slot/season) tiers — by the membership rule it is a per-game setting, not a cascade axis.

All excluded fields are already audited via `list_games` / `list_seasons`. These exclusions are deliberate and enumerated so the boundary is explicit, not a silent gap. A member may be set at only a subset of the per-question tiers; absent tiers read as `undefined` and the generic walker skips them.

#### Scenario: Every tier exposes the same axis keys

- **WHEN** any cascade tier object is inspected for a cascading axis
- **THEN** the axis is readable by the same `keyof CascadeAxes` key on every tier (`slot`, `season`, `game`, `workspace`)
- **AND** a generic reader can obtain `tier[key]` without a per-axis accessor

#### Scenario: Structural-special fields stay off CascadeAxes

- **WHEN** `format`, `categories`, or `theme` is added or changed
- **THEN** it is declared on the specific tier type, not on `CascadeAxes`, and its cascade audit remains in `list_games` / `list_seasons`

#### Scenario: choices is a first-wins member resolvable at every per-question tier

- **WHEN** `choices` is read on a slot, season, game, or workspace tier object
- **THEN** it is accessible by the `keyof CascadeAxes` key `choices` on that tier
- **AND** `resolveCascade("choices", ctx)` walks `slot → season → game → workspace → DEFAULT_TRIVIA_CHOICES`, first-wins

### Requirement: Axis registry is compile-time exhaustive

The plugin SHALL maintain a single `AXIS_REGISTRY` declared with `satisfies Record<keyof CascadeAxes, AxisDef>`. Each registry entry SHALL carry at minimum the axis `kind` (`"first-wins"` or `"custom"`) and its built-in `default` value. Adding a field to `CascadeAxes` without a corresponding `AXIS_REGISTRY` entry SHALL fail TypeScript compilation (`npx tsc`).

#### Scenario: Forgetting a registry entry fails the build

- **WHEN** a new axis field is added to `CascadeAxes` but no entry is added to `AXIS_REGISTRY`
- **THEN** `npx tsc` reports a type error and the build fails
- **AND** the failure names the missing axis key

#### Scenario: Registry default preserves legacy behavior

- **WHEN** an axis resolves with no value set at any tier
- **THEN** the value returned is the registry entry's `default`
- **AND** that default equals the pre-refactor built-in fallback for that axis

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

### Requirement: explain_cascade audit tool

The plugin SHALL expose an `explain_cascade` MCP tool gated to the `member` role (matching `list_games`) on the always-on default server. It SHALL accept a required `game` argument, an optional `slot` argument (slot index within the effective format), and an optional `answersFormat` argument. For the resolved coordinate it SHALL return, for every axis in `AXIS_REGISTRY`, the final resolved `value`, the winning `tier`, and the per-tier `ladder`. For the `answersFormat`-dependent axes (`difficulty`, `difficultyRatio`), the tool SHALL render their resolution for every `answersFormat` value by default, or for the single supplied `answersFormat` when the argument is given. The tool's descriptions and results SHALL remain English (VIA-CLAUDE path).

#### Scenario: Explain at slot level

- **WHEN** a `member`+ user calls `explain_cascade({ game: "x", slot: 0 })`
- **THEN** the response includes, for each registry axis, its resolved `value`, winning `tier`, and per-tier `ladder` for slot 0 of game `x`

#### Scenario: Explain at game level with an active format returns every slot

- **WHEN** a `member`+ user calls `explain_cascade({ game: "x" })` (no `slot`) and an effective format is present (from the active season or the game)
- **THEN** the tool returns one axis-resolution set per slot in the effective format

#### Scenario: Explain at game level with no format

- **WHEN** a `member`+ user calls `explain_cascade({ game: "x" })` (no `slot`) and there is no effective format
- **THEN** the tool resolves the single-question coordinate (slot index `null`) and returns one axis-resolution set

#### Scenario: Seasons disabled

- **WHEN** `explain_cascade` runs while `trivia.seasons.enabled` is `false`
- **THEN** the season tier contributes no value (its `ladder` entry is `undefined`) for every axis, and resolution proceeds through the remaining tiers

#### Scenario: Unknown game is rejected

- **WHEN** `explain_cascade` is called with a `game` not present in `config.trivia.games[]`
- **THEN** the tool returns a structured error naming the unknown game (via the same `requireGame` validation used by other per-game tools)

#### Scenario: Slot out of range is rejected

- **WHEN** `explain_cascade` is called with a `slot` index outside the effective format's range
- **THEN** the tool returns an error naming the tier that defines the format and its slot count

### Requirement: Parser axis set matches CascadeAxes

The config parser's accepted cascading-axis key set SHALL be tied to `keyof CascadeAxes` via a structural parity test. The plugin parses `CascadeAxes` members through more than one path — the weighted axes flow through `parseTriviaAxisBag`, while the flat axes (`hint`, `judgeLeniency`) and string axes (`instructions`, `additionalInstructions`) are parsed directly in `parseTriviaGames` / season / workspace parsing. The parity test SHALL assert that the **union** of all `CascadeAxes`-member keys the parser accepts (across every parse path) equals `keyof CascadeAxes`, so a member cannot be added to a tier without also being parseable and registry-listed, regardless of which parse path handles it.

#### Scenario: Parser parity is asserted across all parse paths

- **WHEN** the test suite runs
- **THEN** a structural test asserts the union of parser-accepted axis keys (weighted bag + directly-parsed flat/string axes) equals `keyof CascadeAxes`
- **AND** the test fails if an axis exists on `CascadeAxes` that no parse path accepts

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


## MODIFIED Requirements

### Requirement: Single CascadeAxes definition is the source of truth

The Trivia plugin SHALL define every cascading axis exactly once in a `CascadeAxes` interface (`src/plugins/trivia/core/cascadeAxes.ts`). Every cascade tier type — `TriviaGame`, `SeasonEntry`, `SeasonFormatSlot`, `PhaseSlice`, and `TriviaConfig` (the workspace tier) — SHALL extend `CascadeAxes` so that all tiers share the identical axis field set keyed by `keyof CascadeAxes`.

**Membership rule.** A field SHALL be a `CascadeAxes` member if and only if it resolves through the **per-question cascade** — i.e. it participates in the slot/phase/season tiers, not merely game+workspace. The 16 members are: the weighted axes (`answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`), the flat axes (`hint`, `judgeLeniency`, `choices`, `choiceEmojiStyle`, `points`), the string axes (`instructions`, `additionalInstructions`), and the post-time axes (`liveAnswersVisible`, `revealResponses`). Membership is independent of WHEN the axis is consumed: `liveAnswersVisible` and `revealResponses` are resolved at post time (`core/liveAnswersResolver.ts`, `core/revealResponsesResolver.ts`) but are first-wins cascades and SHALL be members; `choices` is a `{ min, max }` first-wins bound consumed by both the `get_ideas` choice-count roll and `save_question` length validation.

`CascadeAxes` SHALL NOT contain:

- plain identity fields (`name`, `channel`, cron expressions, `timezone`, `enabled`);
- the **structural-special** cascading fields `format`, `categories`, and `theme`, which keep bespoke cascade semantics (slot composition, category-pool resolution, narrative-label resolution);
- **`allTimeRow`**, which resolves only `game → workspace → default` and never touches the per-question (slot/phase/season) tiers — by the membership rule it is a per-game setting, not a cascade axis.

All excluded fields are already audited via `list_games` / `list_seasons`. These exclusions are deliberate and enumerated so the boundary is explicit, not a silent gap. A member may be set at only a subset of the per-question tiers; absent tiers read as `undefined` and the generic walker skips them.

#### Scenario: Every tier exposes the same axis keys

- **WHEN** any cascade tier object is inspected for a cascading axis
- **THEN** the axis is readable by the same `keyof CascadeAxes` key on every tier (`seasonSlot`, `seasonPhase`, `season`, `gameSlot`, `game`, `workspace`)
- **AND** a generic reader can obtain `tier[key]` without a per-axis accessor

#### Scenario: Structural-special fields stay off CascadeAxes

- **WHEN** `format`, `categories`, or `theme` is added or changed
- **THEN** it is declared on the specific tier type, not on `CascadeAxes`, and its cascade audit remains in `list_games` / `list_seasons`

#### Scenario: choices is a first-wins member resolvable at every per-question tier

- **WHEN** `choices` is read on a slot, phase, season, game, or workspace tier object
- **THEN** it is accessible by the `keyof CascadeAxes` key `choices` on that tier
- **AND** `resolveCascade("choices", ctx)` walks `seasonSlot → seasonPhase → season → gameSlot → game → workspace → DEFAULT_TRIVIA_CHOICES`, first-wins

#### Scenario: A new axis reaches the phase tier for free

- **WHEN** a new member is added to `CascadeAxes` with its `AXIS_REGISTRY` entry
- **THEN** it is settable on `PhaseSlice` and resolvable at the `seasonPhase` tier with no further change

### Requirement: Generic cascade resolver reports value and winning tier

The plugin SHALL provide a generic `resolveCascade(key, ctx)` function that walks the fixed order **`seasonSlot → seasonPhase → season → gameSlot → game → workspace → built-in default`**, returns the first-defined value, and reports the **winning tier** plus the per-tier ladder. The slot tier is split into two concrete tiers: `gameSlot` (from `game.format.questions[i]`) is the authoritative per-question **base**, and `seasonSlot` (the season's per-slot override for index `i`) is the **override** that wins over it. The `seasonPhase` tier is the season's active duration-chained phase slice, and sits below `seasonSlot` so a slot-set axis is pinned against phase movement. `buildCascadeContext` SHALL populate `ctx.gameSlot`, `ctx.seasonSlot`, and `ctx.seasonPhase`; none is re-derived from `season.format` or from the current time inside any resolver.

The same `resolveCascade` function SHALL be the single resolution path used by **`get_ideas` (including the `freeformAnswerShape` roll), `save_question`, `post_questions`, `process_reveal_answers`, and every audit surface (`explain_cascade`)**. No consumer SHALL call a per-axis legacy resolver. Therefore the resolved value and its provenance are computed by one code path for generation, validation, posting, reveal, and audit alike.

#### Scenario: First-defined tier wins and is reported

- **WHEN** an axis is set at the game tier and unset at `seasonSlot`, `seasonPhase`, `season`, and `gameSlot` for a given `(game, slot)`
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

#### Scenario: Active phase overrides the season but not the season slot

- **WHEN** an axis is set on both the active phase and the season, and unset at `seasonSlot`
- **THEN** `resolveCascade` returns the phase's value and reports `tier: "seasonPhase"`
- **AND** when the same axis is also set at `seasonSlot`, the `seasonSlot` value wins instead

#### Scenario: Resolution falls through to default

- **WHEN** an axis is unset at `seasonSlot`, `seasonPhase`, `season`, `gameSlot`, `game`, and `workspace`
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

A custom resolver SHALL compute its `value` from the same context tier objects (`ctx.seasonSlot`, `ctx.seasonPhase`, `ctx.season`, `ctx.gameSlot`, `ctx.game`, `ctx.config`) that its `ladder` iterates — so the returned `value` and the reported `tier`/`ladder` can never disagree. No custom resolver SHALL re-derive the slot from `season.format`, and no custom resolver SHALL hand-enumerate the tier list: the broadest-first walk used by the per-field merge SHALL be derived from `CASCADE_TIER_ORDER` so a new tier cannot be silently skipped.

Because a custom axis can draw its result from more than one tier, the `tier` field SHALL report `"merged"` when the resolved value was assembled from more than one tier, and the single contributing tier otherwise. When `"merged"` is reported, the `ladder` SHALL show which tier supplied each part. The `CascadeTier` type SHALL include `"merged"`, `"seasonSlot"`, `"seasonPhase"`, and `"gameSlot"`.

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

#### Scenario: difficulty merges the phase tier

- **WHEN** `resolveCascade("difficulty", ctx)` runs where the active phase supplies a `hard` range and the game supplies `easy` and `medium`
- **THEN** the merged value takes `hard` from the phase and the other two from the game
- **AND** the `ladder` attributes each field to its contributing tier

### Requirement: Project documentation describes the unified cascade

The project's `CLAUDE.md` "Trivia cascade registry" section SHALL document the cascade as the 7-tier walk **`seasonSlot → seasonPhase → season → gameSlot → game → workspace → built-in default`** (six concrete tiers plus the built-in default) under the game-base / season-override model, and SHALL describe season `slotOverrides`, the `seasonPhase` tier's duration-chained selection and its placement below `seasonSlot`, and the single-resolution-path guarantee across all five consumers (`get_ideas`, `save_question`, `post_questions`, `process_reveal_answers`, `explain_cascade`). It SHALL NOT retain the prior description of the slot tier reading the "effective format" (`season.format ?? game.format`).

#### Scenario: Documentation matches the implemented model

- **WHEN** `CLAUDE.md`'s trivia cascade section is read after this change ships
- **THEN** it states the 7-tier walk including `seasonPhase` and the game-base/season-override model
- **AND** it does not describe a single merged `slot` tier sourced from `resolveEffectiveFormat`

## ADDED Requirements

### Requirement: CASCADE_TIER_ORDER is the single source for every tier walk

`CASCADE_TIER_ORDER` SHALL be the only enumeration of the concrete cascade tiers. Every walk over tiers — the generic first-wins walker, the custom resolvers' broadest-first merge, and the `additionalInstructions` tier labels — SHALL derive its order from that constant rather than hand-listing tiers. Any per-tier lookup table SHALL be typed `Record<ConcreteTier, …>` so an unlisted tier is a compile error.

This closes the gap that a hand-written tier array creates: a new tier that a resolver forgets would otherwise resolve correctly for first-wins axes while being silently skipped for `difficulty` and `difficultyRatio`.

#### Scenario: Adding a tier cannot be silently skipped

- **WHEN** a new member is added to `ConcreteTier` and `CASCADE_TIER_ORDER` but a per-tier lookup is not updated
- **THEN** `npx tsc` fails because the `Record<ConcreteTier, …>` table is no longer exhaustive

#### Scenario: Custom resolvers observe the new tier without edits

- **WHEN** a tier is added to `CASCADE_TIER_ORDER` and populated on `CascadeContext`
- **THEN** `difficulty` and `difficultyRatio` resolve through it with no change to their resolver bodies

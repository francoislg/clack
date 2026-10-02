## MODIFIED Requirements

### Requirement: Single CascadeAxes definition is the source of truth

The Trivia plugin SHALL define every cascading axis exactly once in a `CascadeAxes` interface (`src/plugins/trivia/core/cascadeAxes.ts`). Every cascade tier type — `TriviaGame`, `SeasonEntry`, `SeasonFormatSlot`, `PhaseSlice`, and `TriviaConfig` (the workspace tier) — SHALL extend `CascadeAxes` so that all tiers share the identical axis field set keyed by `keyof CascadeAxes`.

**Membership rule.** A field SHALL be a `CascadeAxes` member if and only if it resolves through the **per-question cascade** — i.e. it participates in the slot/phase/season tiers, not merely game+workspace. The 17 members are: the weighted axes (`answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`), the flat axes (`hint`, `judgeLeniency`, `choices`, `choiceEmojiStyle`, `points`), the string axes (`instructions`, `additionalInstructions`, `judgeInstructions`), and the post-time axes (`liveAnswersVisible`, `revealResponses`). Membership is independent of WHEN the axis is consumed: `liveAnswersVisible` and `revealResponses` are resolved at post time (`core/liveAnswersResolver.ts`, `core/revealResponsesResolver.ts`) but are first-wins cascades and SHALL be members; `choices` is a `{ min, max }` first-wins bound consumed by both the `get_ideas` choice-count roll and `save_question` length validation; `judgeInstructions` is resolved at reveal time for the freeform judge.

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

#### Scenario: judgeInstructions is a member

- **WHEN** `judgeInstructions` is read on a slot, phase, season, game, or workspace tier object
- **THEN** it is accessible by the `keyof CascadeAxes` key `judgeInstructions` on that tier

### Requirement: Custom-resolution axes remain registry-enforced

Axes whose resolution is not pure first-defined-tier-wins SHALL be declared in `AXIS_REGISTRY` with `kind: "custom"` and a bespoke resolver that returns the same `{ value, tier, ladder }` shape. The compiler SHALL still require their presence in the registry. The custom axes are:

- `difficulty` — merges per-field within a tier and is keyed by `answersFormat`.
- `difficultyRatio` — keyed by `answersFormat`.
- `additionalInstructions` — **cumulative**: it concatenates every contributing tier's value rather than selecting one.
- `judgeInstructions` — **cumulative**, through the same concatenation implementation as `additionalInstructions`.

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

#### Scenario: judgeInstructions concatenates contributing tiers

- **WHEN** `resolveCascade("judgeInstructions", ctx)` runs where the game and the season each set a value
- **THEN** it returns both segments, tier-labeled, with `tier: "merged"`
- **AND** the `ladder` identifies which tier supplied each segment

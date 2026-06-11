## MODIFIED Requirements

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

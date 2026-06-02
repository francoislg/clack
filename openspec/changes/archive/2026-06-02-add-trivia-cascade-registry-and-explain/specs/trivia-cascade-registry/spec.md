## ADDED Requirements

### Requirement: Single CascadeAxes definition is the source of truth

The Trivia plugin SHALL define every cascading axis exactly once in a `CascadeAxes` interface (`src/plugins/trivia/core/cascadeAxes.ts`). Every cascade tier type — `TriviaGame`, `SeasonEntry`, `SeasonFormatSlot`, and `TriviaConfig` (the workspace tier) — SHALL extend `CascadeAxes` so that all tiers share the identical axis field set keyed by `keyof CascadeAxes`.

**Membership rule.** A field SHALL be a `CascadeAxes` member if and only if it resolves through the **per-question cascade** — i.e. it participates in the slot/season tiers, not merely game+workspace. The members are: the weighted axes (`answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`), the flat axes (`hint`, `judgeLeniency`), the string axes (`instructions`, `additionalInstructions`), and the post-time axes (`liveAnswersVisible`, `revealResponses`). Membership is independent of WHEN the axis is consumed: `liveAnswersVisible` and `revealResponses` are resolved at post time (`core/liveAnswersResolver.ts`, `core/revealResponsesResolver.ts`) but are 4-tier first-wins cascades and SHALL be members.

`CascadeAxes` SHALL NOT contain:

- plain identity fields (`name`, `channel`, cron expressions, `timezone`, `enabled`);
- the **structural-special** cascading fields `format`, `categories`, and `theme`, which keep bespoke cascade semantics (slot composition, category-pool resolution, narrative-label resolution);
- **`allTimeRow`**, which resolves only `game → workspace → default` and never touches the per-question (slot/season) tiers — by the membership rule it is a per-game setting, not a cascade axis;
- **`choices`**, a workspace-only bound with no per-game/season/slot tier.

All excluded fields are already audited via `list_games` / `list_seasons`. These exclusions are deliberate and enumerated so the boundary is explicit, not a silent gap. A member may be set at only a subset of the per-question tiers; absent tiers read as `undefined` and the generic walker skips them.

#### Scenario: Every tier exposes the same axis keys

- **WHEN** any cascade tier object is inspected for a cascading axis
- **THEN** the axis is readable by the same `keyof CascadeAxes` key on every tier (`slot`, `season`, `game`, `workspace`)
- **AND** a generic reader can obtain `tier[key]` without a per-axis accessor

#### Scenario: Structural-special fields stay off CascadeAxes

- **WHEN** `format`, `categories`, or `theme` is added or changed
- **THEN** it is declared on the specific tier type, not on `CascadeAxes`, and its cascade audit remains in `list_games` / `list_seasons`

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

The plugin SHALL provide a generic `resolveCascade(key, ctx)` function that walks the fixed order `slot → season → game → workspace → built-in default`, returns the first-defined value, and reports the **winning tier** plus the per-tier ladder. The same `resolveCascade` function SHALL be the resolution path used by question generation (`get_ideas`) and by any audit surface, so the resolved value and its provenance are computed by one code path.

#### Scenario: First-defined tier wins and is reported

- **WHEN** an axis is set at the game tier and unset at slot and season for a given `(game, slot)`
- **THEN** `resolveCascade` returns the game-tier value
- **AND** reports `tier: "game"`

#### Scenario: Resolution falls through to default

- **WHEN** an axis is unset at slot, season, game, and workspace
- **THEN** `resolveCascade` returns the registry `default`
- **AND** reports `tier: "default"`

#### Scenario: Production and audit agree (generation axes)

- **WHEN** `get_ideas` rolls an axis and `explain_cascade` reports the same `(game, slot)` axis
- **THEN** the value `get_ideas` resolved equals the `value` `explain_cascade` reports for that axis and tier

#### Scenario: Production and audit agree (post-time axes)

- **WHEN** `post_questions` resolves `liveAnswersVisible` or `revealResponses` for a question and `explain_cascade` reports the same `(game, slot)` axis
- **THEN** both values match, because both call `resolveCascade` — the walker is the single resolution path for generation-time AND post-time axes

### Requirement: Custom-resolution axes remain registry-enforced

Axes whose resolution is not pure first-defined-tier-wins SHALL be declared in `AXIS_REGISTRY` with `kind: "custom"` and a bespoke resolver that returns the same `{ value, tier, ladder }` shape. The compiler SHALL still require their presence in the registry. The custom axes are:

- `difficulty` — merges per-field within a tier and is keyed by `answersFormat`.
- `difficultyRatio` — keyed by `answersFormat`.
- `additionalInstructions` — **cumulative**: it concatenates every contributing tier's value rather than selecting one, so first-wins resolution would drop content (a regression).

Because a custom axis can draw its result from more than one tier, the `tier` field for a `custom` axis SHALL report the sentinel value `"merged"` when the resolved value was assembled from more than one tier, and the single contributing tier otherwise. When `"merged"` is reported, the `ladder` SHALL show which tier supplied each part (each field for `difficulty`, each segment for `additionalInstructions`). The `CascadeTier` type SHALL include `"merged"` for this purpose.

#### Scenario: difficulty stays compiler-required

- **WHEN** `difficulty` is omitted from `AXIS_REGISTRY`
- **THEN** `npx tsc` fails because the registry no longer satisfies `Record<keyof CascadeAxes, AxisDef>`

#### Scenario: Custom resolver reports a single contributing tier

- **WHEN** `resolveCascade("difficulty", ctx)` runs and every merged field came from one tier (e.g. the game tier)
- **THEN** it returns the merged value with `tier: "game"`

#### Scenario: Custom resolver reports merged provenance

- **WHEN** `resolveCascade("difficulty", ctx)` runs and fields were drawn from more than one tier (e.g. one range from the season tier and another from the game tier)
- **THEN** it returns the merged value with `tier: "merged"`
- **AND** the `ladder` identifies which tier supplied each field

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

### Requirement: Resolution outcomes are preserved by the refactor

The registry/resolver refactor SHALL NOT change any axis default, weight, precedence, or resolved outcome. Characterization tests over a representative configuration matrix (seasons on/off, format present/absent, overrides at each tier) SHALL produce identical resolution outcomes before and after the refactor.

#### Scenario: Characterization parity

- **WHEN** the same configuration matrix is resolved before and after the refactor
- **THEN** every axis resolves to the identical value and tier in both runs

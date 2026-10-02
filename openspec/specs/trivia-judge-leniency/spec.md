# trivia-judge-leniency Specification

## Purpose
TBD - created by archiving change add-trivia-judge-leniency. Update Purpose after archive.
## Requirements
### Requirement: Cascading judgeLeniency Axis

The trivia plugin SHALL support a `judgeLeniency` configuration axis whose value is one of exactly four presets: `"strict"`, `"strict-with-typos"`, `"lenient"`, or `"evaluate"`. The axis is a first-wins `CascadeAxes` member and SHALL be settable as an OPTIONAL field on every cascade tier. The effective value SHALL be resolved through `resolveCascade` in precedence order `seasonSlot → seasonPhase → season → gameSlot → game → workspace → built-in default`, with whole-value replace per tier (no merging). The built-in default SHALL be `"strict-with-typos"`.

#### Scenario: Default when no tier sets the axis

- **WHEN** no tier specifies `judgeLeniency`
- **THEN** the resolver returns `"strict-with-typos"`

#### Scenario: Game tier overrides workspace tier

- **WHEN** the workspace sets `judgeLeniency: "strict"` and the game sets `judgeLeniency: "lenient"`, with no season or slot value
- **THEN** the resolver returns `"lenient"`

#### Scenario: Slot tier wins over all lower tiers

- **WHEN** the active season has a `format` whose slot at the resolving index sets `judgeLeniency: "strict"`, and the season, game, and workspace each set a different value
- **THEN** the resolver returns `"strict"`

#### Scenario: Phase tier outranks the season tier

- **WHEN** the season sets `judgeLeniency: "lenient"` and its active phase sets `judgeLeniency: "evaluate"`, with no season-slot value
- **THEN** the resolver returns `"evaluate"`

#### Scenario: Season tier selects evaluate

- **WHEN** the workspace sets `judgeLeniency: "lenient"` and the active season sets `judgeLeniency: "evaluate"`
- **THEN** the resolver returns `"evaluate"`

#### Scenario: Invalid preset rejected at parse time

- **WHEN** a config tier specifies `judgeLeniency: "loose"` (not one of the four presets)
- **THEN** config validation returns an error naming the field and listing the allowed presets
- **AND** the value is not applied

### Requirement: Leniency Preset Composition in the Judge Prompt

The freeform judge prompt SHALL be assembled from named rule fragments such that the active preset selects both the judging basis and the matching-forgiveness fragments, while structural-integrity rules remain universal across all presets. `strict`, `strict-with-typos`, and `lenient` SHALL use the key-match basis: accept an answer that is the expected answer expressed differently, reject a materially-different one, and treat grading Notes as refinements that never override the expected answer. `strict` SHALL forgive only case, numeral↔word substitution, decade-form for a year value, and singular/plural variants. `strict-with-typos` SHALL include everything `strict` forgives PLUS a 1–2 character typo tolerance and loose-writing tolerance (spacing, punctuation, accents, homophones). `lenient` SHALL judge solely whether the player demonstrably knew the answer, ignoring edit distance, while still requiring that the answer could not plausibly mean a different valid answer. `evaluate` SHALL use the evaluate basis defined in "Evaluate Judging Basis". Under every preset, the universal guards — reject multi-guess hedges, reject too-broad answers, treat acceptable variants as additional correct answers, honor grading Notes — SHALL continue to apply. The prompt assembled for `strict`, `strict-with-typos`, and `lenient` SHALL carry the same rules as before the `evaluate` preset existed.

#### Scenario: strict-with-typos preserves current behavior

- **WHEN** the prompt is assembled for the `"strict-with-typos"` preset
- **THEN** it contains the 1–2 character typo tolerance and the loose-writing tolerance
- **AND** for named-entity answers (name/place/title) the effective rule set matches the pre-change default judge behavior; the same tolerance also applies to the other freeform shapes (where typo tolerance was previously absent)

#### Scenario: strict rejects a typo that strict-with-typos accepts

- **WHEN** the active preset is `"strict"` and a player types a 1-character misspelling of the expected answer that is not a case/substitution/plural/decade variant
- **THEN** the judge is instructed to reject it
- **AND** under `"strict-with-typos"` the same answer is within the typo tolerance

#### Scenario: lenient accepts a clearly-known answer written loosely

- **WHEN** the active preset is `"lenient"`, the expected answer is `"Vingt mille lieues sous les mers"`, and a player types `"20 mille lieux sous les mers"`
- **THEN** the judge is instructed to accept it as correct, because it is unmistakably the expected work and could not plausibly mean a different valid answer

#### Scenario: lenient still rejects a hedge

- **WHEN** the active preset is `"lenient"` and a player types `"Paris or London"` against `expectedAnswer: "Paris"`
- **THEN** the judge rejects it with reason `multiple-guess`

#### Scenario: Key-match presets carry the materially-different rejection

- **WHEN** the prompt is assembled for `"strict"`, `"strict-with-typos"`, or `"lenient"`
- **THEN** it instructs the judge to reject an answer materially different from the expected answer
- **AND** it does not contain the evaluate basis

### Requirement: judgeLeniency Stamped on the Question Record

`save_question` SHALL resolve the effective `judgeLeniency` from the live cascade at save time and stamp it on the persisted `TriviaQuestion` record. The reveal judge SHALL read the stamped value to select the preset, so a question is judged by the leniency in effect when it was posed, independent of later config changes. A record with no stamp SHALL be judged as `"strict-with-typos"`.

The stamped value SHALL be re-resolved from the live cascade and re-stamped ONLY when the question is explicitly reprocessed via `compute_answers` reprocess mode (per `trivia-reveal-processor`). Reprocess is the deliberate, explicit escape hatch: the "policy in effect when posed" default holds for every reveal EXCEPT an admin-initiated reprocess, which re-stamps the current cascade value and re-judges the retained answers under it.

#### Scenario: Save stamps the resolved preset

- **WHEN** the effective cascade resolves to `"lenient"` and `save_question` persists a freeform question
- **THEN** the saved record carries `judgeLeniency: "lenient"`

#### Scenario: Mid-cycle config change does not re-judge stamped questions

- **WHEN** a question was saved with `judgeLeniency: "strict"`, and the workspace tier is later changed to `"lenient"` before reveal
- **THEN** the reveal judge uses `"strict"` (the stamped value), not the new config value

#### Scenario: Legacy unstamped record judged as strict-with-typos

- **WHEN** the reveal judge processes a question record that has no `judgeLeniency` field
- **THEN** it selects the `"strict-with-typos"` preset

#### Scenario: Explicit reprocess re-stamps the current cascade value

- **WHEN** a freeform question stamped `judgeLeniency: "strict"` is reprocessed via `compute_answers` reprocess mode while the live cascade resolves to `"lenient"`
- **THEN** the record is re-stamped to `judgeLeniency: "lenient"`
- **AND** the retained answers are re-judged under `"lenient"`

### Requirement: judgeLeniency MCP Read/Write Surface

The trivia management MCP tools SHALL expose `judgeLeniency`. `upsert_game`, `upsert_season` (including its slot and phase tiers), and `set_workspace_config` SHALL each accept an OPTIONAL `judgeLeniency` argument constrained to the four presets, applying it to their respective tier and clearing it when passed null. `list_games` SHALL surface the per-game `judgeLeniency` override on each game entry and the workspace-tier value under `workspaceDefaults`. `list_seasons` SHALL surface the season-tier and slot-tier `judgeLeniency` when set. The four valid presets SHALL be documented in each tool's argument schema, with `evaluate` described as the only preset that accepts a correct answer outside the answer key.

#### Scenario: Set per-game leniency via upsert_game

- **WHEN** an admin calls `upsert_game` with `judgeLeniency: "lenient"` for a game
- **THEN** the saved game carries `judgeLeniency: "lenient"`
- **AND** a subsequent `list_games` surfaces it on that game's entry

#### Scenario: Set workspace default via set_workspace_config

- **WHEN** an admin calls `set_workspace_config` with `judgeLeniency: "strict"`
- **THEN** the workspace config carries `judgeLeniency: "strict"`
- **AND** `list_games` surfaces it under `workspaceDefaults`

#### Scenario: Set evaluate on a season

- **WHEN** an admin calls `upsert_season` with `judgeLeniency: "evaluate"`
- **THEN** the season carries `judgeLeniency: "evaluate"`

#### Scenario: Set evaluate on a phase

- **WHEN** an admin calls `upsert_season` with a phase slice carrying `judgeLeniency: "evaluate"`
- **THEN** that phase carries `judgeLeniency: "evaluate"`

#### Scenario: list_seasons surfaces the season value

- **WHEN** a season carries `judgeLeniency: "evaluate"` and an admin calls `list_seasons`
- **THEN** the season's entry includes `judgeLeniency: "evaluate"`

#### Scenario: Clear a tier override

- **WHEN** an admin calls `upsert_game` with `judgeLeniency: null` for a game that previously had a value
- **THEN** the game no longer carries `judgeLeniency`
- **AND** that game resolves leniency from the next tier down

### Requirement: Evaluate Judging Basis

Under the `evaluate` preset the judge prompt SHALL present the expected answer as a reference solution and SHALL instruct the judge to accept a single committed answer when EITHER it matches the expected answer or an acceptable variant (under the `lenient` knows-it rule) OR it independently satisfies every clue of the question as stated. The judge SHALL be instructed to reject an answer when any clue fails, when the fit depends on a stretch, or when the answer names a category rather than an answer. The multi-guess rejection SHALL still apply, with near-synonyms naming one idea treated as one answer and two distinct ideas treated as a hedge. The judging basis SHALL NOT contain the key-match instruction to reject materially-different answers. The answer-shape rule block, which every preset carries, SHALL be preceded under `evaluate` by a statement scoping its accept/reject clauses to the key-match test, so that a rejection in that block never overrides an alternate-solve acceptance.

#### Scenario: Shape rules are scoped to the key-match test

- **WHEN** the prompt is assembled for an `"evaluate"` question of any freeform shape
- **THEN** the scope statement appears before the shape rules
- **AND** the prompt assembled for a key-match preset carries no such statement

#### Scenario: Valid alternate solve is accepted

- **WHEN** the preset is `"evaluate"`, the question is "The more you take from me, the bigger I grow", the expected answer is `"hole"`, and a player types `"Credit/Loan"`
- **THEN** the judge is instructed to accept an answer that satisfies every clue even though it differs from the expected answer
- **AND** `"Credit/Loan"` is treated as one answer, not a hedge

#### Scenario: Near-miss is still rejected

- **WHEN** the preset is `"evaluate"`, the question is "The maker sells me, the buyer never uses me, the user never knows it", the expected answer is `"coffin"`, and a player types `"Life insurance"`
- **THEN** the judge is instructed to reject an answer for which any clue fails

#### Scenario: Hedge between distinct ideas is rejected

- **WHEN** the preset is `"evaluate"` and a player types `"hole or debt"`
- **THEN** the judge rejects it with reason `multiple-guess`

#### Scenario: Exact match skips the model

- **WHEN** the preset is `"evaluate"` and a player's answer normalizes equal to the expected answer
- **THEN** the answer is accepted without a model call

### Requirement: Evaluate Uses a Stronger Judge Model

A freeform question stamped `judgeLeniency: "evaluate"` SHALL be judged by a Sonnet-tier model. Questions under every other preset SHALL be judged by the default (Haiku) judge model.

#### Scenario: Evaluate question

- **WHEN** an answer to an `evaluate` question reaches the model judge
- **THEN** the call uses the Sonnet-tier judge model

#### Scenario: Other presets

- **WHEN** an answer to a `strict`, `strict-with-typos`, or `lenient` question reaches the model judge
- **THEN** the call uses the default judge model

### Requirement: Alternate Solves Are Labeled at Reveal

When the `evaluate` judge accepts an answer that does not match the expected answer or an acceptable variant, the verdict SHALL carry the reason `alternate-solve`, persisted as the row's `judgeReason`. The reveal payload flags such voters (per `trivia-reveal-processor`). The reveal prompt SHALL instruct Claude, for each flagged voter: when the entry carries `answerText`, to name the accepted alternate answer in the reveal post; when the entry carries no `answerText`, to say that an alternate answer was accepted without quoting it. When the payload carries no voter buckets, the reveal post SHALL contain no alternate-solve narration.

#### Scenario: Accepted alternate carries the reason

- **WHEN** the `evaluate` judge accepts `"Credit/Loan"` against `expectedAnswer: "hole"`
- **THEN** the row is stored with `correct: true` and `judgeReason: "alternate-solve"`

#### Scenario: On-key acceptance carries no alternate reason

- **WHEN** the `evaluate` judge accepts `"a big hole"` against `expectedAnswer: "hole"`
- **THEN** the row's `judgeReason` is not `alternate-solve`

#### Scenario: Reveal prompt names the alternate when text is exposed

- **WHEN** the reveal prompt is assembled
- **THEN** it instructs Claude to name each flagged voter's accepted alternate answer when `answerText` is present

#### Scenario: Reveal prompt handles withheld text

- **WHEN** the reveal prompt is assembled
- **THEN** it instructs Claude to mention that an alternate answer was accepted, without quoting it, when a flagged voter entry has no `answerText`


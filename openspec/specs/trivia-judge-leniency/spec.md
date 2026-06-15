# trivia-judge-leniency Specification

## Purpose
TBD - created by archiving change add-trivia-judge-leniency. Update Purpose after archive.
## Requirements
### Requirement: Cascading judgeLeniency Axis

The trivia plugin SHALL support a `judgeLeniency` configuration axis whose value is one of exactly three presets: `"strict"`, `"strict-with-typos"`, or `"lenient"`. The axis SHALL be settable as an OPTIONAL field on all four cascade tiers — slot (`SeasonFormatSlot`), season (`SeasonEntry`), game (`TriviaGame`), and workspace (`TriviaConfig`). The effective value SHALL be resolved in precedence order `slot → season → game → workspace → built-in default`, with whole-value replace per tier (no merging). The built-in default SHALL be `"strict-with-typos"`.

#### Scenario: Default when no tier sets the axis

- **WHEN** no slot, season, game, or workspace tier specifies `judgeLeniency`
- **THEN** the resolver returns `"strict-with-typos"`

#### Scenario: Game tier overrides workspace tier

- **WHEN** the workspace sets `judgeLeniency: "strict"` and the game sets `judgeLeniency: "lenient"`, with no season or slot value
- **THEN** the resolver returns `"lenient"`

#### Scenario: Slot tier wins over all lower tiers

- **WHEN** the active season has a `format` whose slot at the resolving index sets `judgeLeniency: "strict"`, and the season, game, and workspace each set a different value
- **THEN** the resolver returns `"strict"`

#### Scenario: Invalid preset rejected at parse time

- **WHEN** a config tier specifies `judgeLeniency: "loose"` (not one of the three presets)
- **THEN** config validation returns an error naming the field and listing the allowed presets
- **AND** the value is not applied

### Requirement: Leniency Preset Composition in the Judge Prompt

The freeform judge prompt SHALL be assembled from named rule fragments composed into per-preset arrays, such that the active preset selects the matching-forgiveness fragments while structural-integrity rules remain universal across all presets. `strict` SHALL forgive only case, numeral↔word substitution, decade-form for a year value, and singular/plural variants. `strict-with-typos` SHALL include everything `strict` forgives PLUS a 1–2 character typo tolerance and loose-writing tolerance (spacing, punctuation, accents, homophones). `lenient` SHALL judge solely whether the player demonstrably knew the answer, ignoring edit distance, while still requiring that the answer could not plausibly mean a different valid answer. Under every preset, the universal guards — reject multi-guess hedges, reject too-broad answers, reject materially-different answers, treat acceptable variants as additional correct answers, honor grading Notes — SHALL continue to apply.

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

The trivia management MCP tools SHALL expose `judgeLeniency`. `upsert_game`, `upsert_season` (including the per-slot tier inside a season `format`), and `set_workspace_config` SHALL each accept an OPTIONAL `judgeLeniency` argument constrained to the three presets, applying it to their respective tier and clearing it when passed null. `list_games` SHALL surface the per-game `judgeLeniency` override on each game entry and the workspace-tier value under `workspaceDefaults`. The three valid presets SHALL be documented in each tool's argument schema.

#### Scenario: Set per-game leniency via upsert_game

- **WHEN** an admin calls `upsert_game` with `judgeLeniency: "lenient"` for a game
- **THEN** the saved game carries `judgeLeniency: "lenient"`
- **AND** a subsequent `list_games` surfaces it on that game's entry

#### Scenario: Set workspace default via set_workspace_config

- **WHEN** an admin calls `set_workspace_config` with `judgeLeniency: "strict"`
- **THEN** the workspace config carries `judgeLeniency: "strict"`
- **AND** `list_games` surfaces it under `workspaceDefaults`

#### Scenario: Clear a tier override

- **WHEN** an admin calls `upsert_game` with `judgeLeniency: null` for a game that previously had a value
- **THEN** the game no longer carries `judgeLeniency`
- **AND** that game resolves leniency from the next tier down


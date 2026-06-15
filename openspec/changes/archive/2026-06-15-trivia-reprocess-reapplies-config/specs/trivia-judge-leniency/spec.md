## MODIFIED Requirements

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

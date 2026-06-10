## ADDED Requirements

### Requirement: SeasonFormat accepts an optional `flexible` flag

The Trivia plugin SHALL accept an optional `flexible: boolean` field on the `SeasonFormat` object (the `format` carried by a season entry or a game entry), alongside the existing `questions` array. When absent, `flexible` SHALL read as `false`, and the format SHALL behave exactly as a fixed format does today (byte-for-byte unchanged). The field SHALL be validated as a boolean and rejected otherwise.

`flexible` is a property of the `SeasonFormat` object, NOT a `CascadeAxes` member; it is resolved together with the format it belongs to (see "Flexible rides the format cascade").

#### Scenario: Absent flexible defaults to fixed

- **WHEN** a game or season `format` is written with `{ questions: [{}, {}] }` and no `flexible` field
- **THEN** the format parses successfully and behaves as a fixed 2-slot format (every fire posts exactly 2 questions)

#### Scenario: flexible accepted on write

- **WHEN** `upsert_game` (or `upsert_season`) is called with `format: { questions: [{}, {}, {}], flexible: true }`
- **THEN** the call succeeds and the stored format carries `flexible: true`

#### Scenario: Non-boolean flexible rejected

- **WHEN** a `format` is written with `flexible: "yes"`
- **THEN** the call is rejected with a validation error identifying `format.flexible` as needing a boolean

### Requirement: Flexible format posts a variable prefix of its slots

When the format resolved for a question-cron fire has `flexible: true`, the fire SHALL post a **prefix** of the defined slots — between `0` and `questions.length` questions inclusive, filled in array order — rather than always posting `questions.length`. The count for a given fire SHALL be chosen during generation based on whether each next slot yields a usable question; the slot definitions (per-index shapes/axes) are unchanged. When the resolved format is NOT flexible, the fire SHALL continue to post exactly `questions.length` questions.

Slot identity is preserved: a posted question for slot index `i` carries the same `slot.index` binding it would under a fixed format, so `save_question` index validation (`[0, questions.length)`) and the staged-pool slot-match are unchanged.

#### Scenario: Flexible fire posts fewer than all slots

- **GIVEN** a game with `format: { questions: [{}, {}, {}], flexible: true }`
- **AND** good material exists for slots 0 and 1 but not slot 2
- **WHEN** the question cron fires
- **THEN** exactly two questions are posted (slots 0 and 1, in order)
- **AND** no question is saved or posted for slot 2

#### Scenario: Flexible fire posts the full roster when material is rich

- **GIVEN** a game with `format: { questions: [{}, {}, {}], flexible: true }`
- **AND** good material exists for all three slots
- **WHEN** the question cron fires
- **THEN** exactly three questions are posted, in slot order

#### Scenario: Fixed fire is unaffected

- **GIVEN** a game with `format: { questions: [{}, {}, {}] }` (no `flexible`)
- **WHEN** the question cron fires
- **THEN** exactly three questions are posted regardless of perceived material quality

### Requirement: A flexible fire may post zero questions and skip the day

When a flexible fire finds no usable material for slot 0, it SHALL post **zero** questions: it saves nothing, calls `post_questions` zero times, and terminates the run cleanly with `submit_response({ skip_response: true })`. No question card is posted and no error is raised — the day is skipped. A NON-flexible format SHALL NOT take this path (it always posts its full roster).

#### Scenario: No material yields a clean skip

- **GIVEN** a game with `format: { questions: [{}], flexible: true }`
- **AND** no usable question material is available this fire
- **WHEN** the question cron fires
- **THEN** zero questions are saved and zero are posted
- **AND** the run terminates with `submit_response({ skip_response: true })`
- **AND** no error is surfaced

#### Scenario: Downstream reveal silently skips the zero-question day

- **GIVEN** a flexible game posted zero questions on its question fire
- **WHEN** the matching reveal cron fires
- **THEN** `compute_answers` finds no unprocessed question (`reveals.length === 0`)
- **AND** the reveal run posts nothing and terminates cleanly (reusing the existing empty-reveal skip; no new reveal behavior)
- **AND** season-end rollover bookkeeping, if due, still runs

### Requirement: `get_ideas` surfaces the resolved `flexible` flag

When the format resolved for a `get_ideas` call is flexible, the tool's response SHALL include `flexible: true` alongside the existing `{ slotCount, slots: [...] }` format payload, so the generation prompt can decide to stop early and may post zero. The `slotCount` and per-slot `slots` data SHALL be unchanged by flexibility (`slotCount` remains the ceiling / roster length). When the resolved format is not flexible, the response SHALL omit `flexible` or report it as `false`, preserving today's payload.

#### Scenario: get_ideas reports flexible for a flexible format

- **GIVEN** a game with `format: { questions: [{}, {}], flexible: true }` and no active season
- **WHEN** `get_ideas({ game })` is called
- **THEN** the response includes `flexible: true` and `slotCount: 2`

#### Scenario: get_ideas omits flexible for a fixed format

- **GIVEN** a game with `format: { questions: [{}, {}] }` (no `flexible`)
- **WHEN** `get_ideas({ game })` is called
- **THEN** the response does not report `flexible: true` (the payload matches today's fixed-format shape)

### Requirement: Flexible rides the format cascade (whole-format replace)

`flexible` SHALL be resolved as part of the `format` cascade (`season.format → game.format → none`), which replaces the whole format object per tier — it SHALL NOT resolve independently of the format it belongs to. Consequently, when an active season supplies its own `format`, that season format (and its own `flexible` value, present or absent) wins entirely; a game's `flexible` is masked along with the rest of the game's format. `resolveEffectiveFormat` SHALL require no change to carry `flexible` — it already returns the winning format whole.

#### Scenario: Season format masks a game's flexible flag

- **GIVEN** game `main` has `format: { questions: [{}], flexible: true }`
- **AND** the active season has `format: { questions: [{}, {}] }` (no `flexible`)
- **WHEN** the question cron fires for game `main`
- **THEN** the season's fixed 2-slot format applies and exactly two questions are posted (the game's `flexible: true` is masked)

#### Scenario: Game flexible applies when the season has no format

- **GIVEN** the active season has no `format` field
- **AND** game `main` has `format: { questions: [{}, {}], flexible: true }`
- **WHEN** the question cron fires for game `main`
- **THEN** the game's flexible format applies (a `0..2`-question prefix is posted)

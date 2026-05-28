## ADDED Requirements

### Requirement: Action Button Label Maximum Length

The `submit_response` tool SHALL cap every action-button `label` field at 40 characters. The cap SHALL be enforced at schema parse time so Claude receives a structured error immediately and can retry within the same tool-call loop. The cap SHALL also be enforced at render time as a defense-in-depth check covering any code path that bypasses the Zod schema (including hardcoded defaults supplied by `defaultActionLabel`). The Zod `describe()` text for each `label` field SHALL state the 40-character maximum so Claude has the constraint up front. The 40-character threshold is named `SLACK_BUTTON_LABEL_MAX` and is shared by the schema helper and the runtime validator.

The cap applies uniformly to every action type with a `label` field: `followup`, `choice`, `post_to`, `change`, `config_update`, `update`, `skill_create`, `skill_update`, `skill_disable`, `skill_restore`.

#### Scenario: required label exceeds 40 chars

- **WHEN** Claude calls `submit_response` with an action whose `label` is required (e.g. `followup`, `choice`) and is 41 characters
- **THEN** the schema parse rejects the tool call with a Zod `"String must contain at most 40 character(s)"` error naming the offending field path
- **AND** delivery is NOT attempted
- **AND** Claude receives the error inside the tool-call loop and can retry with a shorter label

#### Scenario: optional label exceeds 40 chars

- **WHEN** Claude calls `submit_response` with an optional `label` (e.g. on `change`, `config_update`, `update`, `post_to`, `skill_*`) that is 41 characters
- **THEN** the schema parse rejects the tool call with the same Zod error naming the offending field path
- **AND** delivery is NOT attempted

#### Scenario: label at exactly 40 chars is accepted

- **WHEN** Claude calls `submit_response` with a `label` of length 40
- **THEN** the schema parse accepts the tool call
- **AND** `validateActionButtonLabels` accepts the rendered button

#### Scenario: hardcoded default labels stay within the cap

- **GIVEN** the `defaultActionLabel(actionType)` function in `src/slack/blocks.ts`
- **WHEN** the function is called with every supported action type
- **THEN** every returned default string has length ≤ 40

#### Scenario: runtime validator catches a label injected outside the schema

- **GIVEN** a code path constructs a button block with a label of length 41 without going through the Zod schema
- **WHEN** `validateActionButtonLabels` runs on the resulting action blocks
- **THEN** the validator returns an error naming the offending action path, the label length, and the 40-character limit

## MODIFIED Requirements

### Requirement: post_to.actions Validated Identically To Top-Level Actions

The validators that today walk `submit_response.actions` SHALL also walk every `post_to.actions` array. Specifically, `validateRefActions`, `validateActionButtonLabels`, and `validateStagedIntentsCoverage` SHALL treat actions inside `post_to.actions` as first-class participants in their checks. The button-label length cap enforced by `validateActionButtonLabels` is 40 characters (`SLACK_BUTTON_LABEL_MAX`), matching the schema-level cap.

#### Scenario: ref inside post_to.actions is checked against the intent store

- **WHEN** Claude submits `submit_response` with `post_to.actions: [{ type: "change", ref: "<unknown-ref>" }]`
- **THEN** `validateRefActions` returns an error indicating the unknown ref and naming the offending action path (e.g., `actions[i].actions[j]`)
- **AND** delivery is NOT attempted

#### Scenario: button label inside post_to.actions exceeds the 40-char Slack visibility limit

- **WHEN** a button label inside `post_to.actions` exceeds 40 characters and somehow bypasses the schema (e.g. injected by `defaultActionLabel` after a future drift)
- **THEN** `validateActionButtonLabels` returns an error naming the offending action path, the label length, and the 40-character limit
- **AND** delivery is NOT attempted

#### Scenario: staged intent placed inside post_to.actions counts toward coverage

- **GIVEN** Claude staged a `propose_change` intent (ref X) earlier in the run
- **WHEN** Claude submits `submit_response` with `post_to.actions: [{ type: "change", ref: "X" }]` and no top-level reference to X
- **THEN** `validateStagedIntentsCoverage` accepts the response (the intent is covered by a `post_to.actions` entry)
- **AND** delivery proceeds

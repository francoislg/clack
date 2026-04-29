## ADDED Requirements

### Requirement: Shared Message-Content Schema Across submit_response and post_to

The `submit_response` tool and the `post_to` action SHALL accept the same message-content surface — `blocks` (required), `actions` (optional/required per surface rules below), and `reactions` (optional) — defined once as a shared schema fragment and spread into both schemas. Adding a new message-content field SHALL update both surfaces without code duplication.

#### Scenario: post_to accepts blocks, actions, and reactions

- **WHEN** Claude calls `submit_response` with a `post_to` action carrying `blocks`, `actions`, and `reactions` arrays
- **THEN** the tool validates each field through the same validators used for the top-level `submit_response` fields
- **AND** persists all three on the per-button snapshot
- **AND** returns success on the deliver path

#### Scenario: top-level submit_response continues to accept the same fields

- **WHEN** Claude calls `submit_response` with top-level `blocks`, `actions`, and `reactions`
- **THEN** the tool's behavior is unchanged from today
- **AND** the fields are validated and delivered exactly as before

#### Scenario: a future content field is added in one place

- **GIVEN** a future change adds a new content field (e.g., `mentions`) to the shared `messageContentFields` fragment
- **WHEN** the change is implemented
- **THEN** both `submit_response` and `post_to.actions` automatically gain the field at the schema boundary, with no schema duplication

### Requirement: post_to Carries Optional Reactions

The `post_to` action SHALL accept an optional `reactions: string[]` field. When the `post_to` is delivered (auto-execute path or button-click path), the reactions SHALL be added to the cross-posted message via `client.reactions.add` using the same helper, error handling, and silent-ignore semantics as the top-level `submit_response.reactions` field.

#### Scenario: auto-path post_to with reactions adds reactions to the cross-posted message

- **GIVEN** Claude submits `submit_response` with `{ type: "post_to", auto: true, channel: "C123", blocks, reactions: ["white_check_mark"] }`
- **WHEN** the auto-execute handler posts the cross-posted message
- **THEN** the post returns a message timestamp
- **AND** the handler calls `addDeliveryReactions(client, "C123", ts, ["white_check_mark"])`
- **AND** each emoji is added as a reaction on the cross-posted message

#### Scenario: button-click post_to with persisted reactions adds reactions on click

- **GIVEN** Claude submits `submit_response` with a `post_to` action whose snapshot persists `{ blocks, reactions: ["thumbsup"] }`
- **WHEN** the user clicks the rendered button
- **THEN** the handler reads `snapshot.reactions` and forwards it to `postAnswerToChannel`
- **AND** after the cross-posted message is posted, each emoji is added as a reaction

#### Scenario: invalid reactions on post_to are silently ignored

- **WHEN** a `reactions` entry on a `post_to` action is invalid (e.g., unknown emoji)
- **THEN** the system logs a warning and continues
- **AND** the cross-post itself is NOT affected
- **AND** other valid reactions are still applied

#### Scenario: post_to without reactions does not call reactions.add

- **WHEN** a `post_to` action omits the `reactions` field (or provides an empty array)
- **THEN** the handler does NOT call `addDeliveryReactions`
- **AND** the cross-posted message is delivered with no reactions

### Requirement: post_to Carries Optional Actions

The `post_to` action SHALL accept an optional `actions: Action[]` field. When present, the actions SHALL be rendered as Slack action buttons on the cross-posted message via `getResponseActionBlocks`, using the **original session's ID** so click handlers route back to the original session's `intentStore` and snapshot store. The same action variants accepted at the top level (`followup`, `choice`, `change`, `config_update`, `update`) SHALL be accepted inside `post_to.actions`, with one exception: nested `post_to` SHALL be rejected.

#### Scenario: post_to with followup action renders a button on the cross-posted message

- **GIVEN** Claude submits `submit_response` with `post_to.actions: [{ type: "followup", label: "Tell me more", prompt: "..." }]`
- **WHEN** the cross-posted message is delivered (either path)
- **THEN** the rendered Slack message includes an action block with the followup button
- **AND** the button's action_id matches the existing `clack_followup_<index>` pattern
- **AND** the button's value encodes the original session ID

#### Scenario: clicking a cross-posted ref-based action resolves against the original session

- **GIVEN** Claude staged a `propose_change` intent in session S, then submitted `submit_response` with `post_to.actions: [{ type: "change", ref: "<refId>" }]`
- **WHEN** a user clicks the rendered button on the cross-posted message
- **THEN** the click handler decodes the value, resolves session S, and looks up the ref in S's `intentStore`
- **AND** the change workflow starts as if the button had been clicked in S's original thread

#### Scenario: clicking a cross-posted followup re-engages the original session

- **GIVEN** a cross-posted message with a `followup` button whose value encodes session S
- **WHEN** a user clicks the button
- **THEN** Clack re-invokes Claude in session S with the followup prompt
- **AND** the response is delivered in S's original channel/thread, not the cross-posted location

#### Scenario: nested post_to inside post_to.actions is rejected

- **WHEN** Claude submits `submit_response` with `post_to.actions: [{ type: "post_to", blocks: [...] }]`
- **THEN** the tool returns a validation error naming the offending action index
- **AND** the error message states that nested `post_to` is not supported
- **AND** delivery is NOT attempted

#### Scenario: post_to without actions delivers without buttons

- **WHEN** a `post_to` action omits the `actions` field (or provides an empty array)
- **THEN** the cross-posted message has no action block
- **AND** delivery proceeds with `blocks` only (plus reactions if present)

### Requirement: post_to.actions Validated Identically To Top-Level Actions

The validators that today walk `submit_response.actions` SHALL also walk every `post_to.actions` array. Specifically, `validateRefActions`, `validateActionButtonLabels`, and `validateStagedIntentsCoverage` SHALL treat actions inside `post_to.actions` as first-class participants in their checks.

#### Scenario: ref inside post_to.actions is checked against the intent store

- **WHEN** Claude submits `submit_response` with `post_to.actions: [{ type: "change", ref: "<unknown-ref>" }]`
- **THEN** `validateRefActions` returns an error indicating the unknown ref and naming the offending action path (e.g., `actions[i].actions[j]`)
- **AND** delivery is NOT attempted

#### Scenario: button label inside post_to.actions exceeds Slack's 75-char limit

- **WHEN** a button label inside `post_to.actions` exceeds 75 characters
- **THEN** `validateActionButtonLabels` returns an error naming the offending action path and the label length
- **AND** delivery is NOT attempted

#### Scenario: staged intent placed inside post_to.actions counts toward coverage

- **GIVEN** Claude staged a `propose_change` intent (ref X) earlier in the run
- **WHEN** Claude submits `submit_response` with `post_to.actions: [{ type: "change", ref: "X" }]` and no top-level reference to X
- **THEN** `validateStagedIntentsCoverage` accepts the response (the intent is covered by a `post_to.actions` entry)
- **AND** delivery proceeds

### Requirement: post_to Snapshot Captures actions and reactions

The per-button snapshot persisted for each `post_to` action SHALL store `actions` and `reactions` alongside `text` and `blocks` so the button-click delivery path can replay them after an arbitrary delay between submit time and click time.

#### Scenario: snapshot includes actions and reactions when present

- **WHEN** `submit_response` persists a snapshot for a `post_to` action that has `actions` and `reactions`
- **THEN** the snapshot record includes both fields verbatim
- **AND** the snapshot ID stored on the rendered button resolves to that record

#### Scenario: snapshot omits actions and reactions when absent

- **WHEN** `submit_response` persists a snapshot for a `post_to` action that omits `actions` and `reactions`
- **THEN** the snapshot record contains `text` and `blocks` only (no spurious empty arrays)

#### Scenario: button-click delivery replays snapshot actions and reactions

- **GIVEN** a snapshot persisted with `{ blocks, actions, reactions }`
- **WHEN** the user clicks the corresponding button
- **THEN** the handler renders `actions` as button blocks, posts the combined message, and applies `reactions` after delivery

### Requirement: addDeliveryReactions Helper Is Shared Across Outbound Surfaces

The reaction-application helper that today lives inside `src/slack/handlers/handlerResponse.ts` SHALL be exported from a shared module (`src/slack/messageReactions.ts`) and consumed by both the `submit_response` delivery path and the `post_to` delivery paths. No outbound surface SHALL reimplement reaction-application logic.

#### Scenario: submit_response delivery uses the shared helper

- **WHEN** the streamer/fallback delivery path applies reactions after posting
- **THEN** it imports `addDeliveryReactions` from `src/slack/messageReactions.ts`

#### Scenario: post_to delivery (auto + button) uses the shared helper

- **WHEN** the auto-execute handler or the button-click handler applies reactions to the cross-posted message
- **THEN** it imports `addDeliveryReactions` from `src/slack/messageReactions.ts`

#### Scenario: a future change to reaction error handling lands in one place

- **GIVEN** a future change wants to alter how reaction-application errors are logged or retried
- **WHEN** the change is implemented in `src/slack/messageReactions.ts`
- **THEN** all outbound surfaces inherit the new behavior automatically

### Requirement: Nested post_to Is Rejected

The `post_to` action SHALL NOT contain a nested `post_to` action inside its `actions` array. The validator SHALL reject any such configuration with an actionable error.

#### Scenario: nested post_to fails validation

- **WHEN** Claude submits `submit_response` whose `actions` includes a `post_to` action whose own `actions` includes another `post_to`
- **THEN** the tool returns a validation error identifying the offending action path
- **AND** the message states that nested `post_to` is not supported and suggests using a separate `post_to` at the top level

#### Scenario: top-level post_to remains valid

- **WHEN** Claude submits `submit_response` with one or more top-level `post_to` actions, each carrying its own `blocks`/`actions`/`reactions`
- **THEN** all top-level `post_to` actions are accepted
- **AND** the recursion check applies only to actions *inside* a `post_to.actions` array

## MODIFIED Requirements

### Requirement: post_to Actions Carry Blocks

The `post_to` action SHALL carry a `blocks: Block[]` payload representing the shareable response content. The legacy `content: string` field is removed. The action MAY additionally carry optional `actions` (rendered as buttons on the cross-posted message) and `reactions` (applied to the cross-posted message after delivery), with semantics defined in the *post_to Carries Optional Actions* and *post_to Carries Optional Reactions* requirements. When the user clicks the `post_to` button, the stored blocks (and any persisted `actions` and `reactions`) are prepared and posted via `chat.postMessage` with the blocks attached and reactions applied after.

#### Scenario: post_to action with blocks is accepted

- **WHEN** Claude includes a `post_to` action with a valid `blocks` array
- **THEN** the tool validates the blocks using the same rules as the response body
- **AND** persists the blocks (along with any `actions`/`reactions` present) to the snapshot store under the action's snapshot ID

#### Scenario: post_to action with invalid blocks is rejected

- **WHEN** Claude includes a `post_to` action whose blocks fail validation
- **THEN** the tool returns a validation error identifying the action index and the block violation
- **AND** does not deliver the primary response

#### Scenario: post_to button click posts persisted blocks

- **GIVEN** a `post_to` action snapshot persisted with `{blocks}` (and optional `actions`/`reactions`) at a snapshot ID
- **WHEN** the user clicks the button
- **THEN** the handler loads the snapshot, calls `prepareBlocks`, renders any `actions` as button blocks, posts the result via `chat.postMessage` to the target channel and thread, and applies any `reactions` after the post returns

#### Scenario: post_to button click with unparseable snapshot surfaces an expired error

- **GIVEN** a `post_to` action snapshot in the legacy `{text, sections}` shape (e.g., created before this change)
- **WHEN** the user clicks the button
- **THEN** the handler surfaces a friendly "link expired" error to the user rather than attempting delivery

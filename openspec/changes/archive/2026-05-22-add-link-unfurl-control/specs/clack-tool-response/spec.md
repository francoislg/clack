## MODIFIED Requirements

### Requirement: submit_response Tool

The system SHALL provide a `submit_response` MCP tool that defines the user-facing response with structured content and actions, and delivers it to Slack. The tool also supports a `skip_response` mode that declines to answer. The tool optionally accepts emoji reactions to add to the posted message. The tool optionally accepts a `suppress_unfurls: boolean` field; when `true`, the delivered message disables Slack's link and media unfurling.

#### Scenario: Basic response with sections

- **WHEN** Claude calls `submit_response` with a sections array
- **THEN** each section contains an optional `title` (string) and a required `body` (string, markdown)
- **AND** the tool validates the rendered blocks
- **AND** the tool delivers the response to Slack via the injected deliver callback
- **AND** captures the payload for session persistence
- **AND** returns a delivery confirmation to Claude

#### Scenario: Response with reactions

- **WHEN** Claude calls `submit_response` with a `reactions` array of emoji names
- **AND** the response is delivered successfully
- **THEN** the delivery layer adds each emoji as a reaction on the posted response message
- **AND** reactions are added in parallel after delivery

#### Scenario: Reaction with invalid emoji

- **WHEN** a reaction emoji name is invalid or does not exist
- **THEN** the system logs a warning
- **AND** the overall response delivery is NOT affected
- **AND** other valid reactions in the array are still added

#### Scenario: Reaction already added

- **WHEN** a reaction emoji was already added to the message (e.g., duplicate in the array)
- **THEN** the system silently ignores the `already_reacted` error

#### Scenario: Reactions without delivery

- **WHEN** Claude calls `submit_response` with `reactions` but no `deliver` callback is configured
- **THEN** the reactions are ignored (no Slack client to add them)
- **AND** the response is captured normally

#### Scenario: Delivery returns message timestamp

- **WHEN** the delivery callback posts a message to Slack
- **THEN** the delivery result includes the posted message's `ts` field
- **AND** the `ts` is used by the delivery layer to target reactions

#### Scenario: Response with suppress_unfurls true

- **WHEN** Claude calls `submit_response` with `suppress_unfurls: true`
- **THEN** the deliver callback is invoked with `suppressUnfurls: true`
- **AND** the underlying `chat.postMessage` call contains `unfurl_links: false` and `unfurl_media: false`
- **AND** the response is captured and persisted as today

#### Scenario: Response without suppress_unfurls

- **WHEN** Claude calls `submit_response` without `suppress_unfurls` (or with `false`)
- **THEN** the deliver callback is invoked without `suppressUnfurls` (or with `false`)
- **AND** the underlying `chat.postMessage` call does NOT include `unfurl_links` or `unfurl_media`
- **AND** Slack applies its default unfurling

### Requirement: post_to Actions Carry Blocks

The `post_to` action SHALL carry a `blocks: Block[]` payload representing the shareable response content. The legacy `content: string` field is removed. The action MAY additionally carry optional `actions` (rendered as buttons on the cross-posted message), `reactions` (applied to the cross-posted message after delivery), and `suppress_unfurls: boolean` (disables link/media unfurling on the cross-posted message), with semantics defined in the *post_to Carries Optional Actions*, *post_to Carries Optional Reactions*, and `link-unfurl-control` requirements. When the user clicks the `post_to` button, the stored blocks (and any persisted `actions`, `reactions`, and `suppressUnfurls` value) are prepared and posted via `chat.postMessage` with the blocks attached, reactions applied after, and unfurling disabled when the persisted flag is `true`.

#### Scenario: post_to action with blocks is accepted

- **WHEN** Claude includes a `post_to` action with a valid `blocks` array
- **THEN** the tool validates the blocks using the same rules as the response body
- **AND** persists the blocks (along with any `actions`/`reactions`/`suppress_unfurls` present) to the snapshot store under the action's snapshot ID

#### Scenario: post_to action with invalid blocks is rejected

- **WHEN** Claude includes a `post_to` action whose blocks fail validation
- **THEN** the tool returns a validation error identifying the action index and the block violation
- **AND** does not deliver the primary response

#### Scenario: post_to button click posts persisted blocks

- **GIVEN** a `post_to` action snapshot persisted with `{blocks}` (and optional `actions`/`reactions`/`suppressUnfurls`) at a snapshot ID
- **WHEN** the user clicks the button
- **THEN** the handler loads the snapshot, calls `prepareBlocks`, renders any `actions` as button blocks, posts the result via `chat.postMessage` to the target channel and thread (with `unfurl_links: false` and `unfurl_media: false` when the snapshot's `suppressUnfurls` is `true`), and applies any `reactions` after the post returns

#### Scenario: post_to with suppress_unfurls true posts with unfurling disabled

- **GIVEN** Claude submits `submit_response` with `{ type: "post_to", auto: true, channel: "C123", blocks, suppress_unfurls: true }`
- **WHEN** the auto-execute handler cross-posts the message
- **THEN** the `chat.postMessage` call contains `unfurl_links: false` and `unfurl_media: false`

#### Scenario: post_to button click with persisted suppressUnfurls

- **GIVEN** a `post_to` snapshot persisted with `suppressUnfurls: true`
- **WHEN** the user clicks the rendered button
- **THEN** the deferred handler posts the cross-posted message with `unfurl_links: false` and `unfurl_media: false`

#### Scenario: post_to button click with unparseable snapshot surfaces an expired error

- **GIVEN** a `post_to` action snapshot in the legacy `{text, sections}` shape (e.g., created before this change)
- **WHEN** the user clicks the button
- **THEN** the handler surfaces a friendly "link expired" error to the user rather than attempting delivery

### Requirement: DeliverFn Supports postTopLevel Routing

The `DeliverFn` type SHALL accept an optional `postTopLevel` boolean and an optional `suppressUnfurls` boolean. When `postTopLevel` is `true`, the implementation SHALL delete the streamer's in-thread message (if any) and post via `chat.postMessage` without a `thread_ts`. When `suppressUnfurls` is `true`, the implementation SHALL include `unfurl_links: false` and `unfurl_media: false` in the `chat.postMessage` call. When either flag is `false` or absent, the corresponding behavior matches the prior thread-reply / default-unfurl delivery.

#### Scenario: postTopLevel routes via chat.postMessage without thread_ts

- **WHEN** the deliver callback is invoked with `postTopLevel: true`
- **THEN** the implementation calls `client.chat.postMessage` with the session's `channel` and without `thread_ts`
- **AND** the streamer (if present) is stopped and its message is deleted before the post

#### Scenario: postTopLevel delivery failure surfaces to the caller

- **WHEN** `chat.postMessage` throws during a top-level post
- **THEN** the deliver callback returns `{ ok: false, error }` with the error message
- **AND** the caller (submit_response) returns a `delivery_failed` tool error to Claude

#### Scenario: deliver with suppressUnfurls true forwards to postMessage

- **WHEN** the deliver callback is invoked with `suppressUnfurls: true`
- **THEN** the resulting `chat.postMessage` call contains `unfurl_links: false` and `unfurl_media: false`
- **AND** both thread-reply and top-level routing variants honor the flag identically

#### Scenario: deliver without suppressUnfurls

- **WHEN** the deliver callback is invoked without `suppressUnfurls` (or with `false`)
- **THEN** the resulting `chat.postMessage` call does NOT include `unfurl_links` or `unfurl_media`

# gif-plugin

## Purpose

A built-in Clack plugin that integrates Tenor GIF search via the `find_gif` MCP tool, with strict SFW content filtering, randomized results, and Slack Block Kit rendering.

## Requirements

### Requirement: GIF plugin registration
The system SHALL ship a built-in `gif` plugin that follows the Clack plugin SDK contract and becomes active when `"gif"` is listed in `data/config.json → plugins`.

#### Scenario: Plugin registered in config
- **WHEN** `data/config.json` lists `"gif"` in `plugins` and the bot starts
- **THEN** the plugin loads, its MCP tools become available as `mcp__gif__*`, and its baseline instructions are included in the system prompt

#### Scenario: Plugin absent from config
- **WHEN** `"gif"` is not listed in `plugins`
- **THEN** no GIF tools are registered and no GIF instructions are injected into the prompt

### Requirement: find_gif tool
The plugin SHALL expose a single MCP tool named `find_gif` that takes a search query and returns an array of GIF results from Tenor.

#### Scenario: Successful search
- **WHEN** Claude calls `find_gif({ query: "celebrate" })` with a valid Tenor API key configured
- **THEN** the tool returns a non-empty array of objects, each with `url`, `previewUrl`, and `title` fields, sourced from Tenor's `/v2/search` endpoint

#### Scenario: Query with custom limit
- **WHEN** Claude calls `find_gif({ query: "facepalm", limit: 3 })`
- **THEN** the tool returns up to 3 result objects

#### Scenario: Default limit
- **WHEN** Claude calls `find_gif({ query: "shipped" })` without specifying `limit`
- **THEN** the tool returns exactly 1 result object

#### Scenario: Tenor returns no results
- **WHEN** the Tenor API returns an empty result set for the query
- **THEN** the tool returns an empty array and a message indicating no matches were found

### Requirement: SFW enforcement
The plugin SHALL force the strictest available content filter on every Tenor request so results are always safe for workplace Slack channels.

#### Scenario: Content filter applied
- **WHEN** any `find_gif` call is made
- **THEN** the HTTP request to Tenor includes `contentfilter=high` and this value cannot be overridden by tool arguments

### Requirement: Randomized results
The plugin SHALL return different GIFs across repeated calls with the same query rather than the same top-ranked result every time.

#### Scenario: Repeated same query
- **WHEN** Claude calls `find_gif({ query: "celebrate" })` twice in succession
- **THEN** the two calls are likely to return different GIFs (the request uses Tenor's randomization, e.g. `random=true`)

### Requirement: API key via environment
The plugin SHALL read its Tenor API key from the `GIF_TENOR_API_KEY` environment variable and the non-secret `client_key` identifier MUST be set to `clack`.

#### Scenario: Key present
- **WHEN** `GIF_TENOR_API_KEY` is set in `data/auth/.env` and the bot starts
- **THEN** the plugin uses that key on every Tenor request and includes `client_key=clack`

#### Scenario: Key missing
- **WHEN** `GIF_TENOR_API_KEY` is unset and Claude calls `find_gif`
- **THEN** the plugin loads normally but the tool call returns an error result explaining the missing key and pointing to the setup location (`data/auth/.env`)

### Requirement: Baseline usage instructions
The plugin SHALL inject baseline instructions into the `user` role config (via the plugin SDK's `addInstruction`) that tell Claude when and how to use `find_gif`.

#### Scenario: Instructions loaded
- **WHEN** the plugin loads
- **THEN** a file `user/gif__usage.md` is registered through the plugin SDK and appears in the cascading config resolver's output for every session

#### Scenario: Required rules present
- **WHEN** the instructions file is rendered into the system prompt
- **THEN** it explicitly states: (a) GIF URLs MUST come from `find_gif` — never invented, (b) one GIF maximum per message, (c) GIFs are forbidden in reaction-triggered (ephemeral) responses, (d) any message containing a GIF MUST include "via Tenor" attribution

### Requirement: Trigger-mode scoping
The system SHALL prevent GIFs from appearing in reaction-triggered ephemeral responses.

#### Scenario: Reaction-triggered response
- **WHEN** Claude is responding to a reaction-trigger and the response is ephemeral (only visible to the reactor)
- **THEN** the response MUST NOT contain a GIF URL (enforced via the baseline instructions)

#### Scenario: DM or mention response
- **WHEN** Claude is responding in a DM or @mention trigger mode
- **THEN** a GIF MAY be included when it fits the conversation, subject to the one-per-message and attribution rules

### Requirement: Slack rendering via Block Kit image block
The system SHALL render GIFs via Block Kit `image` blocks in the `submit_response` payload and MUST NOT rely on Slack URL unfurling or file uploads.

#### Scenario: GIF delivered in message
- **WHEN** Claude includes a GIF returned by `find_gif` in its response
- **THEN** the `submit_response` payload contains an `image` block whose `image_url` is the `find_gif` URL and whose `alt_text` is a short description, and no raw Tenor URL appears in the text body

### Requirement: Tenor attribution
The plugin SHALL require visible Tenor attribution on any message that includes a GIF.

#### Scenario: Attribution text present
- **WHEN** Claude composes a response that includes a `find_gif` URL
- **THEN** the response body includes the text "via Tenor" (per the baseline instructions)

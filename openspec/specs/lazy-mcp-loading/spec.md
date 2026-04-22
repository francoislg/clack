# lazy-mcp-loading Specification

## Purpose
Lazy-load non-core MCP servers on demand via `attach_integration` tool, reducing baseline token cost and improving session startup speed. Always-on servers (clack, github) are attached at session start; others are attached dynamically when Claude requests them. Includes integration registry, catalog injection, persistence across resume, baseline token visibility, and thinking-indicator feedback.

## Requirements

### Requirement: MCP Server Registry

The system SHALL maintain a Clack-owned registry of MCP servers separately from `data/mcp.json`, stored under `config.mcpServers` in `data/config.json`. Each entry SHALL declare `alwaysLoad: boolean` and `description: string`.

#### Scenario: Unregistered mcp.json server is auto-loaded with a warning

- **GIVEN** `data/mcp.json` declares a server named `metabase`
- **AND** `data/config.json`'s `mcpServers` has no `metabase` entry
- **WHEN** the bot starts up
- **THEN** startup completes successfully
- **AND** a warning is logged at `warn` level identifying `metabase` as unmapped and noting it has been treated as `alwaysLoad: true` in memory
- **AND** the in-memory effective registry includes a synthetic entry `{ alwaysLoad: true, description: "(unmapped — add a description in config.json to enable lazy loading)" }` for `metabase`
- **AND** `metabase` is therefore attached at session start (behavior parity with today's "attach every mcp.json server" default), preserving functionality until the operator fills in a real registry entry

#### Scenario: Registry entry fields validated

- **GIVEN** `data/config.json` has `mcpServers.metabase = { alwaysLoad: true }` (missing `description`)
- **WHEN** the bot loads config
- **THEN** config validation fails with an error identifying the missing `description` field

#### Scenario: Auto-injected GitHub gets default entry

- **GIVEN** `data/config.json`'s `mcpServers` has no `github` entry
- **AND** GitHub MCP auto-injection conditions are met (GitHub App credentials present, binary available)
- **WHEN** the bot starts up
- **THEN** a synthetic registry entry `{ alwaysLoad: true, description: "GitHub MCP — PRs, issues, code search" }` is used for `github`

#### Scenario: Operator override of auto-injected GitHub

- **GIVEN** `data/config.json`'s `mcpServers.github` explicitly declares `{ alwaysLoad: false, description: "Custom" }`
- **WHEN** the bot starts up
- **THEN** the operator's entry wins; `github` is not always-loaded

#### Scenario: Instructions-only integration

- **GIVEN** `data/config.json`'s `mcpServers.scheduling = { alwaysLoad: false, description: "Scheduled messages" }`
- **AND** `data/mcp.json` has no `scheduling` entry
- **WHEN** the bot loads
- **THEN** validation passes (registry entries without a matching `mcp.json` server are valid — they represent instructions-only topics)

### Requirement: Always-On Subset at Session Start

The system SHALL attach only `alwaysLoad: true` MCP servers at the start of a new SDK session. Non-always-on servers SHALL NOT be attached until `attach_integration` is called.

#### Scenario: New session attaches only always-on servers

- **GIVEN** the registry has `clack` and `github` as `alwaysLoad: true` and 7 other servers as `alwaysLoad: false`
- **WHEN** a new query session starts (reactions, mentions, DM, autoRespond, or scheduled)
- **THEN** the SDK's `mcpServers` option contains only `clack` and `github`
- **AND** none of the other 7 servers' tool schemas appear in the session's initial context

#### Scenario: Baseline token cost measurement

- **GIVEN** a reference query of the category "codebase question requiring no external MCP" (captured against the pre-change implementation, recorded in `openspec/changes/add-lazy-mcp-loading/` for reference)
- **WHEN** the same query runs against the post-change implementation (always-on subset only; no `attach_integration` calls)
- **THEN** the initial turn's `cache_creation_input_tokens` is at least 50% lower than the recorded pre-change value
- **AND** both values are documented in the change folder so reviewers can audit the comparison

### Requirement: `attach_integration` Tool

The system SHALL expose an internal tool `attach_integration(name: string)` to Claude that dynamically attaches an MCP server and returns its topic instructions. The tool SHALL be available in query-mode sessions (reactions, DMs, mentions, autoRespond, threadReply, scheduled) and hidden in worker-mode.

#### Scenario: Successful attach brings tools and instructions

- **GIVEN** Claude is in a query-mode session with only always-on servers attached
- **AND** the registry has `metabase = { alwaysLoad: false, description: "..." }` and `data/mcp.json` has a `metabase` server
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **THEN** the SDK's `setMcpServers` is called with the union of currently-attached servers and `metabase`
- **AND** the tool's text result SHALL begin with the literal string `Attached integration: metabase.` followed by the concatenated contents of `{role}/topics/metabase/*.md` resolved through the cascade
- **AND** when the topic folder contains multiple files (e.g., `metabase.md` and `company-dashboards.md`), all files are concatenated in alphabetical filename order under a single topic header; no per-file header is emitted
- **AND** the Metabase MCP tools (e.g., `mcp__metabase__*`) become available for Claude's next turn

#### Scenario: Duplicate attach is idempotent

- **GIVEN** `metabase` is already attached in the current session
- **WHEN** Claude calls `attach_integration({ name: "metabase" })` again
- **THEN** the tool returns a success result with text `"Integration already attached: metabase. No additional action taken."`
- **AND** topic instructions are NOT re-injected (no duplicate content in the conversation)
- **AND** `setMcpServers` is NOT called

#### Scenario: Unknown integration name

- **GIVEN** the registry has no entry named `frobnicator`
- **WHEN** Claude calls `attach_integration({ name: "frobnicator" })`
- **THEN** the tool returns an error result with text of the form `Unknown integration: frobnicator. Available integrations: <comma-separated list of all registry entry names, alphabetical>.`
- **AND** `setMcpServers` is NOT called
- **AND** the list includes every registry entry (both always-on and lazy) so Claude can see the full surface area

#### Scenario: Instructions-only integration (no MCP server)

- **GIVEN** the registry has `scheduling = { alwaysLoad: false, description: "..." }`
- **AND** `data/mcp.json` has no `scheduling` entry
- **WHEN** Claude calls `attach_integration({ name: "scheduling" })`
- **THEN** `setMcpServers` is NOT called
- **AND** the tool returns a success result with the topic instructions from `{role}/topics/scheduling/*.md`
- **AND** `session.attachedIntegrations` records `scheduling`

#### Scenario: MCP connection failure during attach

- **GIVEN** `attach_integration("monday")` is called and the Monday MCP fails to connect (e.g., expired token)
- **WHEN** `setMcpServers` returns `{ errors: { monday: "auth failed" }, ... }`
- **THEN** the tool returns an error result containing the connection error text
- **AND** `session.attachedIntegrations` does NOT record `monday`
- **AND** a thinking-indicator update reports the failure

### Requirement: Integrations Catalog in System Prompt

The system SHALL inject a compact catalog of available integrations into the system prompt on every query-mode turn. The catalog SHALL include each non-always-on registry entry with its `description`. The internal `clack` server SHALL NOT appear in the catalog.

#### Scenario: Catalog includes non-always-on entries with descriptions

- **GIVEN** the registry has `clack` and `github` as always-on and `metabase`, `monday`, `sentry` as non-always-on
- **WHEN** the system prompt is built for any query-mode turn
- **THEN** the prompt contains a section listing `metabase`, `monday`, `sentry` with their descriptions
- **AND** `clack` and `github` are NOT listed (clack is internal; github is always-on and its tools are already available)
- **AND** the catalog is ordered alphabetically by integration name

#### Scenario: Catalog omitted when empty

- **GIVEN** every registry entry has `alwaysLoad: true`
- **WHEN** the system prompt is built
- **THEN** the integrations catalog section is omitted entirely

### Requirement: Persistence of Attached Integrations Across Resume

The system SHALL persist the set of attached integrations on the Clack session and re-attach them at the start of each resumed SDK session.

#### Scenario: Resume re-attaches previously attached integrations

- **GIVEN** a prior turn in the session called `attach_integration("metabase")` successfully
- **AND** `session.attachedIntegrations` contains `"metabase"`
- **WHEN** the next turn resumes the SDK session
- **THEN** Clack calls `query.setMcpServers(alwaysOn ∪ { metabase })` before streaming the first user message of the resumed turn

#### Scenario: Stale attached integration dropped silently

- **GIVEN** `session.attachedIntegrations` contains `"removed-server"`
- **AND** the registry no longer has an entry for `removed-server`
- **WHEN** the session resumes
- **THEN** `removed-server` is logged as dropped and removed from `session.attachedIntegrations`
- **AND** the session continues normally with the remaining valid attachments

### Requirement: Startup Baseline Token Smoke Test

The system SHALL, at bot startup, launch a small asynchronous Claude query per role tier (`user`, `dev`, `admin`) with the same MCP set and cascade that tier would normally receive, and log each query's initial `cache_creation_input_tokens`. This provides continuous, in-production visibility into the baseline prompt size — a regression tripwire for changes that silently re-inflate the baseline (e.g., a new always-on MCP, a large topical file accidentally moved back to the baseline cascade).

#### Scenario: Startup logs baseline token count per role

- **WHEN** the bot starts up (after config is loaded and before Slack event handlers are registered)
- **THEN** an asynchronous task kicks off a minimal query (a single-turn prompt like `"ping"` that returns immediately) for each role tier: `user`, `dev`, `admin`
- **AND** each query uses the same always-on MCP subset, cascade resolver output, and integrations catalog that a real query for that role would receive
- **AND** each query is capped at `maxTurns: 1` and a short wall-clock timeout (e.g., 60s) so a slow MCP spawn never blocks the main event loop
- **AND** the `cache_creation_input_tokens` from the first assistant turn is logged at `info` level along with the role, in a single structured line (e.g. `baseline.tokens role=user tokens=18452`)
- **AND** the smoke test runs fire-and-forget — failures log a warning but never block startup

#### Scenario: Unmapped mcp.json server reflected in smoke-test output

- **GIVEN** a new mcp.json server was added without a registry entry (handled per "Unregistered mcp.json server is auto-loaded with a warning" above)
- **WHEN** the startup smoke test runs
- **THEN** the logged baseline reflects the auto-loaded server's cost, so operators can see the size impact alongside the existing unmapped-warning log line

#### Scenario: Smoke test respects role chain

- **GIVEN** `dev` role's cascade includes `dev/changes.md` (not loaded for `user`)
- **WHEN** the smoke test runs for `dev` and `user`
- **THEN** the two queries report different token counts reflecting their different cascades
- **AND** the difference is attributable to the role-specific instructions (verifiable by inspection)

### Requirement: Thinking-Indicator Visibility

The system SHALL update the Slack thinking indicator when `attach_integration` runs, so users can see when an integration is loading, has loaded, or failed.

#### Scenario: Start, success, and failure transitions

- **WHEN** `attach_integration("metabase")` is called
- **THEN** a `tool.start` event updates the thinking indicator to `Attaching metabase…`
- **AND** on success, the indicator updates to `Attached metabase`
- **AND** on failure, the indicator updates to `Failed to attach metabase: <error>`

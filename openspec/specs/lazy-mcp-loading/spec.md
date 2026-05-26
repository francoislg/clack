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

The system SHALL expose an internal tool `attach_integration(name: string)` to Claude that dynamically attaches an MCP server and returns its topic instructions. The tool SHALL be available in query-mode sessions (reactions, DMs, mentions, autoRespond, threadReply, scheduled) and hidden in worker-mode. The tool SHALL resolve the requested name through a single unified resolver: first via `loadMcpServer(name)` (external `data/mcp.json` entries), then via the per-session plugin-registered server registry on `McpServerManager` (servers declared by plugins via `sdk.registerMcpServer`). The tool SHALL be idempotent against both the dynamically-attached set AND the session-start baseline: when the requested integration is already part of the session-start baseline (e.g. `alwaysLoad: true`) and the SDK reports it as `connected`, the tool SHALL skip `setMcpServers` entirely and return a short success message indicating the integration is always-loaded. When the requested integration is in the baseline but is NOT reported as `connected`, the tool SHALL fall through to a real attach as graceful recovery.

When the unified resolver returns a server config (from either source), the tool SHALL call `setMcpServers(baseline ∪ attached ∪ {name})` and the server's tools become available on the next turn. When the resolver returns nothing AND the registry entry exists (genuine instructions-only entry — e.g., a `data/config.json` entry without an `mcp.json` server AND without a plugin-registered server), the tool SHALL skip `setMcpServers` and return only the topic instructions.

#### Scenario: Successful attach brings tools and instructions (external MCP-backed)

- **GIVEN** Claude is in a query-mode session with only always-on servers attached
- **AND** the registry has `metabase = { alwaysLoad: false, description: "..." }` and `data/mcp.json` has a `metabase` server
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **THEN** the SDK's `setMcpServers` is called with the union of currently-attached servers and `metabase`
- **AND** the tool's text result SHALL begin with the literal string `Attached integration: metabase.` followed by the concatenated contents of `{role}/topics/metabase/*.md` resolved through the cascade
- **AND** when the topic folder contains multiple files (e.g., `metabase.md` and `company-dashboards.md`), all files are concatenated in alphabetical filename order under a single topic header; no per-file header is emitted
- **AND** the Metabase MCP tools (e.g., `mcp__metabase__*`) become available for Claude's next turn

#### Scenario: Successful attach brings tools and instructions (plugin-registered)

- **GIVEN** Claude is in a query-mode session with only always-on servers attached
- **AND** the trivia plugin has called `sdk.registerMcpServer("management", { autoload: false, description: "..." })` and bound tools `upsertSeason`, `upsertGame` etc. via the returned handle
- **AND** the effective registry contains `trivia:management = { alwaysLoad: false, description: "..." }`
- **AND** `data/mcp.json` has no `trivia:management` entry
- **WHEN** Claude calls `attach_integration({ name: "trivia:management" })`
- **THEN** `loadMcpServer("trivia:management")` returns undefined, then `McpServerManager.getPluginServer("trivia:management")` returns the SDK server config built from the plugin's handle
- **AND** the SDK's `setMcpServers` is called with the union of currently-attached servers and the plugin's `trivia:management` server
- **AND** the tools (e.g., `mcp__trivia_management__upsert_season`) become available for Claude's next turn
- **AND** `session.attachedIntegrations` records `"trivia:management"`
- **AND** `mcpAttachHistory` records `outcome: "ok"` (NOT `"instructions_only"`, because tools were attached)

#### Scenario: Duplicate attach is idempotent

- **GIVEN** `metabase` is already attached in the current session
- **WHEN** Claude calls `attach_integration({ name: "metabase" })` again
- **THEN** the tool returns a success result with text `"Integration already attached: metabase. No additional action taken."`
- **AND** topic instructions are NOT re-injected (no duplicate content in the conversation)
- **AND** `setMcpServers` is NOT called

#### Scenario: Baseline-loaded integration short-circuits when SDK reports it connected

- **GIVEN** the registry has `mongodb-prod = { alwaysLoad: true, description: "..." }`
- **AND** the session-start baseline includes `mongodb-prod`
- **AND** the SDK's `Query.mcpServerStatus()` reports `mongodb-prod` with `status: "connected"`
- **WHEN** Claude calls `attach_integration({ name: "mongodb-prod" })`
- **THEN** the tool returns a success result whose text indicates the integration is always-loaded and its tools are already available (e.g. `"Integration mongodb-prod is always-loaded as part of the session baseline — its tools are already available. No attach needed; proceed using the integration's tools directly."`)
- **AND** `setMcpServers` is NOT called
- **AND** topic instructions are NOT re-injected
- **AND** the attempt is recorded in `session.mcpAttachHistory` with `outcome: "duplicate"`

#### Scenario: Baseline-loaded integration falls through to real attach when not connected

- **GIVEN** the registry has `mongodb-prod = { alwaysLoad: true, description: "..." }`
- **AND** the session-start baseline includes `mongodb-prod`
- **AND** the SDK's `Query.mcpServerStatus()` reports `mongodb-prod` with `status` other than `"connected"` (e.g. `"failed"`, `"pending"`, `"needs-auth"`, `"disabled"`), or `mongodb-prod` is absent from the status list, or the status probe throws
- **WHEN** Claude calls `attach_integration({ name: "mongodb-prod" })`
- **THEN** the tool falls through to a real attach: the unified resolver is called and `setMcpServers` is invoked with the baseline + dynamic + `mongodb-prod` union
- **AND** the resulting outcome (success or failure) is reported and persisted using the existing real-attach paths

#### Scenario: Unknown integration name

- **GIVEN** the registry has no entry named `frobnicator`
- **WHEN** Claude calls `attach_integration({ name: "frobnicator" })`
- **THEN** the tool returns an error result with text of the form `Unknown integration: frobnicator. Available integrations: <comma-separated list of all registry entry names, alphabetical>.`
- **AND** `setMcpServers` is NOT called
- **AND** the list includes every registry entry (both always-on and lazy) so Claude can see the full surface area

#### Scenario: Instructions-only integration (no server in either source)

- **GIVEN** the registry has `scheduling = { alwaysLoad: false, description: "..." }`
- **AND** `data/mcp.json` has no `scheduling` entry
- **AND** no plugin has called `sdk.registerMcpServer(...)` that resolves to `scheduling`
- **WHEN** Claude calls `attach_integration({ name: "scheduling" })`
- **THEN** the unified resolver returns undefined from both sources
- **AND** `setMcpServers` is NOT called
- **AND** the tool returns a success result with the topic instructions from `{role}/topics/scheduling/*.md`
- **AND** `session.attachedIntegrations` records `scheduling`
- **AND** `mcpAttachHistory` records `outcome: "instructions_only"`

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

The system SHALL, at bot startup, launch a small asynchronous Claude query per role tier (`user`, `dev`, `admin`) with the same MCP set, skill-plugin set, cascade, and user-prompt catalog blocks that tier would normally receive, and log each query's initial `cache_creation_input_tokens`. This provides continuous, in-production visibility into the baseline prompt size — a regression tripwire for changes that silently re-inflate the baseline (e.g., a new always-on MCP, a new eager skill plugin, a large topical file accidentally moved back to the baseline cascade).

#### Scenario: Startup logs baseline token count per role

- **WHEN** the bot starts up (after config is loaded and before Slack event handlers are registered)
- **THEN** an asynchronous task kicks off a minimal query (a single-turn prompt like `"ping"` that returns immediately) for each role tier: `user`, `dev`, `admin`
- **AND** each query uses the same always-on MCP subset, cascade resolver output, integrations catalog, skill-packs catalog, and filtered skill-plugin set (`discoverEagerSkillPlugins`) that a real query for that role would receive
- **AND** the SkillsManager and McpServerManager are wired into the tool context so `list_skill_pack_skills`, `load_skill`, and `attach_integration` register into baseline exactly as they would for a real session
- **AND** each query is capped at `maxTurns: 1` and a short wall-clock timeout (e.g., 60s) so a slow MCP spawn never blocks the main event loop
- **AND** the `cache_creation_input_tokens` from the first assistant turn is logged at `info` level along with the role, in a single structured line (e.g. `baseline.tokens role=user tokens=18452`)
- **AND** the smoke test runs fire-and-forget — failures log a warning but never block startup

#### Scenario: Lazy-tagged skill pack excluded from baseline

- **GIVEN** `config.skillPlugins.marketingskills.lazyLoad === true`
- **WHEN** the startup smoke test runs for any role
- **THEN** `marketingskills` is NOT passed to the SDK as a `--plugin-dir` entry for the smoke query
- **AND** its 32 skill frontmatter entries are NOT part of the measured baseline
- **AND** the `AVAILABLE SKILL PACKS` catalog block contributes a single-line entry (`- marketingskills — …`) in place of the 32 frontmatter entries

#### Scenario: Eager skill pack still contributes to baseline

- **GIVEN** `config.skillPlugins.devtools.lazyLoad === false` (or no registry entry — eager by default)
- **WHEN** the startup smoke test runs
- **THEN** `devtools` is passed as a `--plugin-dir` entry and its full skill frontmatter enters the measured baseline, matching a real session

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

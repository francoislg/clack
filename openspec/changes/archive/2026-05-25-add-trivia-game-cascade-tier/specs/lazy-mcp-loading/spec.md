## ADDED Requirements

### Requirement: trivia_management integration catalog entry

The integration registry SHALL recognize `trivia_management` as a valid integration name. The default catalog SHALL include an entry `mcpServers.trivia_management = { alwaysLoad: false, description: "Manage trivia games (add/remove/configure) and workspace-tier defaults. Admin only." }` shipped in the repository's default `data/config.json`.

The entry SHALL be `alwaysLoad: false` so its topic instructions are only injected when an admin (or Claude on behalf of an admin) calls `attach_integration("trivia_management")`. The integration's "MCP server" is conceptual — the underlying tools (`upsert_game`, `delete_game`, `set_workspace_config`) are clack-internal and always-registered for admins. The integration name and entry exist to anchor the topic instructions and let admins discover the toolset via the standard `attach_integration` catalog.

#### Scenario: Catalog includes trivia_management

- **GIVEN** the system loads `data/config.json`
- **WHEN** the integration catalog is assembled
- **THEN** `trivia_management` appears in the catalog
- **AND** its description is non-empty

#### Scenario: attach_integration accepts trivia_management

- **GIVEN** an admin session
- **WHEN** Claude calls `attach_integration({ name: "trivia_management" })`
- **THEN** the call succeeds and returns the trivia-management topic instructions
- **AND** subsequent turns in the same session continue to see those instructions

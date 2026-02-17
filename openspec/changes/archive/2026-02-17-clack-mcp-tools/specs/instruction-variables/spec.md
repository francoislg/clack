## MODIFIED Requirements

### Requirement: Variable Definition Registry

The system SHALL maintain a centralized registry of all instruction template variables in `src/instructionVariables.ts`.

Each variable definition SHALL include:
- `name`: The variable key (e.g. `BOT_NAME`)
- `description`: Human-readable description of what the variable contains
- `availability`: Either `"always"` (available in all instruction files) or `"dev-admin"` (only meaningful in dev/admin instruction files)

#### Scenario: Registry contains all defined variables

- **WHEN** the registry is loaded
- **THEN** it contains a definition for every variable that `buildSystemPrompt()` produces
- **AND** each definition has a non-empty `name`, `description`, and `availability`

#### Scenario: Registry is exported for external use

- **WHEN** another module imports from `instructionVariables.ts`
- **THEN** it can access the full list of variable definitions
- **AND** it can access the `VariableDefinition` type

## REMOVED Requirements

### Requirement: Available Variables Meta-Variable

**Reason**: The `{AVAILABLE_VARIABLES}` meta-variable existed to document available template variables in admin instructions. With most variables removed (replaced by query tools), the table would contain only `BOT_NAME` and is no longer useful. Admins can discover available tools via their tool descriptions.

**Migration**: Remove `buildAvailableVariablesTable()` function. Remove `{AVAILABLE_VARIABLES}` from admin instruction files. Remove the registry entry for `AVAILABLE_VARIABLES`.

### Requirement: Config Update Block Variable

**Reason**: The `{CONFIG_UPDATE_BLOCK}` variable injected XML format documentation and file lists into admin prompts. Replaced by `propose_config_update` tool (provides format via schema) and `list_config_files` query tool (provides file list on demand).

**Migration**: Remove `CONFIG_UPDATE_BLOCK` from the registry and from `buildSystemPrompt()`. Remove the corresponding placeholder from admin instruction files.

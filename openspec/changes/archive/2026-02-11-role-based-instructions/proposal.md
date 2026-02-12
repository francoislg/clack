## Why

The system prompt is currently a single file for all users, with role-specific behavior (change detection for devs, "info only" for members) hardcoded as TypeScript strings in `buildSystemPrompt()`. This makes it impossible to customize role-specific instructions without code changes. Admins should be able to tailor how Clack behaves for different roles, and the hardcoded prompt blocks should live in editable files.

## What Changes

- **BREAKING** Rename `data/templates/` to `data/default_configuration/` — these are shipped defaults, not templates
- **BREAKING** Remove `claudeCode.systemPromptFile` from config — replaced by convention-based file lookup
- Introduce convention-based instruction files: `instructions.md` (base, always loaded) + role-specific overlays (`dev_instructions.md`, `admin_instructions.md`, `user_instructions.md`)
- Composition model: final prompt = base file + role file (appended)
- Resolution chain per file: `data/configuration/{file}` → `data/default_configuration/{file}`
- Extract hardcoded "Change Request Detection" block into `default_configuration/dev_instructions.md` with `{CHANGE_REPOS_LIST}` and `{RESUMABLE_SESSIONS}` variables
- Extract hardcoded "Critical: Information Only" block into `default_configuration/user_instructions.md`
- Role file selection logic: dev/admin/owner with changesWorkflow enabled → `dev_instructions.md` (or `admin_instructions.md`); everyone else → `user_instructions.md`
- Fallback: `admin_instructions.md` falls back to `dev_instructions.md` if not present
- Variable interpolation in all instruction files: `{REPOSITORIES_LIST}`, `{BOT_NAME}`, `{MCP_INTEGRATIONS}`, `{CHANGE_REPOS_LIST}`, `{RESUMABLE_SESSIONS}`
- Bootstrap on startup: copy `default_configuration/` files to `configuration/` if they don't exist

## Capabilities

### New Capabilities
- `instruction-system`: Convention-based role-specific instruction files with resolution chain and variable interpolation

### Modified Capabilities
- `claude-code-integration`: Replace hardcoded prompt blocks with file-based loading; remove `systemPromptFile` config; change `buildSystemPrompt()` to use the new instruction system

## Impact

- **Code**: Rewrite `buildSystemPrompt()` and `loadInstructionsTemplate()` in `src/claude.ts`; add instruction resolution module; add bootstrap logic in startup
- **Config**: Remove `claudeCode.systemPromptFile` from `ClaudeCodeConfig` interface and `DEFAULTS`; update `config.example.json`
- **Files**: Rename `data/templates/` → `data/default_configuration/`; create role-specific instruction files; update `.gitignore`
- **Breaking**: Existing deployments with custom `systemPromptFile` will need to move their file to `data/configuration/instructions.md`

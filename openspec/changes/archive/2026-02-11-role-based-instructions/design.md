## Context

Today, `buildSystemPrompt()` in `src/claude.ts` loads a single instruction file and appends hardcoded TypeScript strings based on role/config:
- Devs with changesWorkflow enabled get a ~50-line "Change Request Detection" block
- Everyone else gets a ~3-line "Critical: Information Only" block

The single file is specified by `claudeCode.systemPromptFile` (default: `templates/default_instructions.md`). All variable interpolation (`{REPOSITORIES_LIST}`, etc.) happens in code.

This design replaces the single-file approach with convention-based role files, makes the hardcoded blocks editable, and introduces a two-tier resolution chain (editable overrides → shipped defaults).

## Goals / Non-Goals

**Goals:**
- Role-specific instruction files that compose with a shared base
- Editable overrides in `data/configuration/` that take precedence over shipped defaults in `data/default_configuration/`
- Variable interpolation across all instruction files
- Extract all hardcoded prompt blocks from TypeScript into files
- Remove `systemPromptFile` config in favor of convention

**Non-Goals:**
- Conditional logic or if/else within instruction files (keep it simple — code picks the file, file is static text + variables)
- Per-repository instruction overrides
- Editing UI (covered by `admin-edit-instructions` change)

## Decisions

### Decision: Convention-based file names

Fixed filenames by convention, no config needed:

| File | Purpose | When loaded |
|------|---------|-------------|
| `instructions.md` | Base prompt (shared by all) | Always |
| `dev_instructions.md` | Dev/change-capable additions | Dev/admin/owner + changesWorkflow enabled |
| `admin_instructions.md` | Admin-specific additions | Admin/owner + changesWorkflow enabled (fallback: dev) |
| `user_instructions.md` | Member/read-only additions | Everyone else |

**Why not configurable names?** Convention over configuration. The filenames are self-documenting and there's no use case for renaming them. Removing `systemPromptFile` simplifies the config.

### Decision: Two-tier resolution chain

For each file, look in `data/configuration/` first, then `data/default_configuration/`:

```
resolve("instructions.md"):
  1. data/configuration/instructions.md     ← editable override
  2. data/default_configuration/instructions.md  ← shipped default
  3. (not found → error for base, skip for role files)
```

**Why two tiers?** `default_configuration/` ships with the repo (checked in, read-only defaults). `configuration/` is deployment-specific (gitignored, admin-editable). This separation means `git pull` updates defaults without clobbering customizations.

### Decision: Role file selection based on role + config

```
if (role is dev/admin/owner AND changesWorkflow enabled for this trigger):
    role_file = admin_instructions.md (for admin/owner)
                dev_instructions.md   (for dev)
    fallback:  dev_instructions.md    (if admin file not found)
else:
    role_file = user_instructions.md
```

"Dev instructions" means "change-capable user instructions." A dev with changesWorkflow disabled gets `user_instructions.md` because they have no change capabilities in that context.

### Decision: Variable interpolation in all files

All instruction files support the same variables, interpolated after concatenation:

| Variable | Source | Available when |
|----------|--------|---------------|
| `{REPOSITORIES_LIST}` | Config repositories with descriptions | Always |
| `{BOT_NAME}` | `slackApp.name` config | Always |
| `{MCP_INTEGRATIONS}` | Configured MCP server names | Always |
| `{CHANGE_REPOS_LIST}` | Repos with `supportsChanges: true` | changesWorkflow enabled |
| `{RESUMABLE_SESSIONS}` | Active sessions for the user | changesWorkflow enabled |

Variables not available in context resolve to empty string.

### Decision: Rename `templates/` → `default_configuration/`

`data/templates/` → `data/default_configuration/`. The old name implied "starting points to copy from." The new name says "these are the shipped defaults that can be overridden."

### Decision: No bootstrap copy on startup

Unlike the `admin-edit-instructions` change, this change does NOT auto-copy defaults to `configuration/`. The resolution chain handles it — if no override exists, the default is used directly. The `admin-edit-instructions` change will handle creating `configuration/` files when an admin edits.

This keeps things simple: fresh installs use defaults, customizations happen explicitly.

## Risks / Trade-offs

- **Breaking: `systemPromptFile` removal**: Deployments with a custom `systemPromptFile` need to move their file to `data/configuration/instructions.md`. → Mitigation: log a clear error on startup if the old config key is detected.
- **Breaking: `templates/` rename**: Any references to `data/templates/` in external scripts or Docker volumes break. → Mitigation: update Dockerfile, docker-setup.sh, gce-deploy.sh.
- **Variable injection**: Malicious content in variables (e.g., repo descriptions) could influence the prompt. → Acceptable: repo descriptions are set by the admin who deploys Clack, not by end users.
- **Empty variables**: If `{CHANGE_REPOS_LIST}` is empty, the dev instructions may read awkwardly. → Mitigation: the default `dev_instructions.md` should be written to read naturally even with empty variables, or code should omit the role file entirely when the variable would be empty (which is what the role selection logic already does).

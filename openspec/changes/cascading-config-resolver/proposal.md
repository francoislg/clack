## Why

The current instruction system uses flat, monolithic role files (`instructions.md`, `dev_instructions.md`, `admin_instructions.md`). Admins who want to customize one aspect (e.g., response style) must duplicate the entire file, making it hard to stay current with shipped defaults. There's no way to override just one topic per role level — it's all or nothing.

A directory-based, cascading system lets each instruction topic live in its own file, with higher role directories overriding lower ones file-by-file. Users can also drop in custom files that never get overridden, enabling organization-specific context without conflicting with shipped defaults.

## What Changes

- **Replace flat role files with role directories**: `instructions.md` + `user_instructions.md` → `user/*.md`, `dev_instructions.md` → `dev/*.md`, `admin_instructions.md` → `admin/*.md`, `owner/*.md` (empty by default)
- **Split shipped defaults** into topic files: `user/identity.md`, `user/response-style.md`, `user/submit-response.md`, `user/urls.md`, `user/changes.md`, `dev/github.md`, `dev/changes.md`, `admin/config-updates.md`
- **CascadingConfigResolver**: takes an ordered `string[]` of role levels (e.g., `["user", "dev"]`), scans directories, resolves each filename through the cascade. Resolution order per file: `default/{role1}/{file}` < `custom/{role1}/{file}` < `default/{role2}/{file}` < `custom/{role2}/{file}` — last one that exists wins. Empty files suppress the instruction.
- **Dynamic file discovery**: scan role directories at resolution time instead of maintaining a hardcoded file list. New files are discovered automatically.
- **Role chain builder**: caller constructs the role array based on user role and `changesWorkflowEnabled`. Dev layer is gated by changesWorkflow; admin layer always applies for admin+ users. This enables `["user", "admin"]` (admin without changes workflow — keeps config management, skips code change instructions).
- **MCP tool updates**: `list_config_files` returns files grouped by role directory. `read_config_file` returns both `default_content` and `custom_content` (no redundant `resolved_content`). `propose_config_update` accepts `{role}/{filename}` paths and supports creating new files.
- **Smart file placement**: Claude's config update instructions teach it to analyze existing files and decide whether to merge content into an existing file, create a new one, or ask the user when uncertain.
- **Resolved view for admins**: admins can ask Clack "what does a dev see?" and get the full cascaded result, or compare default vs customized content for any file.
- **Home Tab**: Configuration section shows one line per role directory with summary counts (e.g., `user/ — 5 default, 2 custom`) instead of one line per file. Still admin-only.
- **Boot migration**: Claude-powered migration splits existing `data/configuration/` overrides into the new directory structure.

## Capabilities

### New Capabilities
- `cascading-config-resolver`: Core resolution engine — takes ordered role chain, scans role directories in both default and custom tiers, resolves each filename through the cascade, concatenates results into the final instruction set.

### Modified Capabilities
- `instruction-system`: Replaces flat file convention with role directories and cascading resolution. Changes prompt composition from "base + one role file" to "all resolved files from cascade". Variable interpolation still applies post-concatenation.
- `config-update-via-chat`: Tools adapt to directory-based paths (`{role}/{file}`). `read_config_file` returns both default and custom content. `propose_config_update` supports creating new files. Claude instructions updated for smart file placement.
- `home-tab`: Configuration section switches from per-file rows to per-directory summary lines with file counts and customization status.

## Impact

- **`src/instructions.ts`**: Major rewrite — `loadInstructions()` replaced by CascadingConfigResolver. `resolveInstructionFile()` updated for directory structure.
- **`src/configurationFiles.ts`**: `listInstructionFiles()` switches from hardcoded list to directory scanning. `readInstructionFile()` and `writeInstructionFile()` updated for `{role}/{file}` paths.
- **`data/default_configuration/`**: Restructured from flat files to `user/`, `dev/`, `admin/` directories. Old flat files removed.
- **`src/tools/query/listConfigFiles.ts`**: Response format changes to grouped-by-directory.
- **`src/tools/query/readConfigFile.ts`**: Returns `default_content` + `custom_content` instead of single resolved content.
- **`src/tools/actions/proposeConfigUpdate.ts`**: Accepts directory-scoped paths, supports new file creation.
- **`src/slack/homeTab.ts`**: `buildConfigurationSection()` rewritten for directory summary display.
- **`src/claude/promptBuilder.ts`**: Calls new resolver instead of `loadInstructions()`.
- **`src/changes/execution.ts`**: Per-repo instruction loading unchanged (separate concern).
- **Migration**: New blocking migration to split existing `data/configuration/` overrides.
- **`.dockerignore`**: May need updates for new directory structure.
- **Existing deployments**: Migration handles the transition; no manual steps required.

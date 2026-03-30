## 1. CascadingConfigResolver Core

- [x] 1.1 Create `src/cascadingConfigResolver.ts` with the resolver function: takes `string[]` role chain, scans directories in both `default_configuration/` and `configuration/`, collects unique `.md` filenames, resolves each through the interleaved cascade (default/role1 < custom/role1 < default/role2 < custom/role2), excludes empty files, concatenates in alphabetical order
- [x] 1.2 Create `buildRoleChain(role, changesWorkflowEnabled)` function that returns the ordered role array (e.g., `["user"]`, `["user", "dev"]`, `["user", "admin"]`, `["user", "dev", "admin"]`)
- [x] 1.3 Write tests for the resolver: basic cascading, two-tier within role, empty file suppression, custom-only additive files, alphabetical ordering, non-md files ignored
- [x] 1.4 Write tests for `buildRoleChain`: all role × changesWorkflow combinations

## 2. Split Default Configuration

- [x] 2.1 Create `data/default_configuration/user/identity.md` — product expert persona, tool access intro, MCP integrations (from current `instructions.md` top section)
- [x] 2.2 Create `data/default_configuration/user/urls.md` — URL → MCP tool mapping patterns (from current `instructions.md` "URLs and MCP Tools" section)
- [x] 2.3 Create `data/default_configuration/user/response-style.md` — how to respond, silent investigation + `user/information-guardrails.md` — no hallucination (split per user feedback)
- [x] 2.4 Create `data/default_configuration/user/submit-response.md` — submit_response usage, actions by delivery context, length limits, send_to_thread rules (from current `instructions.md` "Submitting Your Response" section)
- [x] 2.5 Create `data/default_configuration/user/changes.md` — "Information Only" restriction (from current `user_instructions.md`)
- [x] 2.6 Create `data/default_configuration/dev/github.md` — GitHub MCP tools, PR review checking (from current `dev_instructions.md` first two sections)
- [x] 2.7 Create `data/default_configuration/dev/changes.md` — propose_change workflow, auto-execute rules (from current `dev_instructions.md` "Code Changes" + "Auto-execute" sections)
- [x] 2.8 Create `data/default_configuration/admin/config-updates.md` — propose_config_update workflow, config management, admin-specific auto-execute example (from current `admin_instructions.md`)
- [x] 2.9 Remove old flat files: `instructions.md`, `user_instructions.md`, `dev_instructions.md`, `admin_instructions.md` from `data/default_configuration/`

## 3. Wire Resolver Into Application

- [x] 3.1 Update `src/instructions.ts`: replace `loadInstructions()` with a call to the CascadingConfigResolver, using `buildRoleChain()` to construct the role chain. Keep `interpolateVariables()` applied post-concatenation. Update `validateInstructionFiles()` to check for at least one file in `user/` directory.
- [x] 3.2 Update `src/claude/promptBuilder.ts` if it calls `loadInstructions()` directly — ensure it passes through the new resolver path
- [x] 3.3 Verify per-repo instruction files (`{repo}/changes_instructions.md`, `{repo}/worktree_setup_instructions.md`) are unaffected — they should still use flat two-tier resolution
- [x] 3.4 Update existing `src/instructions.test.ts` (or create if missing): test that `loadInstructions()` delegates to the resolver correctly, test `validateInstructionFiles()` with new directory structure, test that `interpolateVariables()` still works post-concatenation

## 4. Update Configuration File Management

- [x] 4.1 Update `src/configurationFiles.ts`: replace `ROLE_INSTRUCTION_FILES` constant and `listInstructionFiles()` with directory scanning. Scan both `default_configuration/` and `configuration/` role directories, return files grouped by directory with source status (`default`, `customized`, `custom-only`)
- [x] 4.2 Update `readInstructionFile()` to accept `{role}/{filename}` paths and return `{ default_content, custom_content }` instead of single resolved content
- [x] 4.3 Update `writeInstructionFile()` to handle `{role}/{filename}` paths, creating role directories as needed. Keep path traversal protection.
- [x] 4.4 Write tests for the updated configuration file functions

## 5. Update MCP Tools

- [x] 5.1 Update `src/tools/query/listConfigFiles.ts`: return grouped-by-directory structure with per-file source status
- [x] 5.2 Update `src/tools/query/readConfigFile.ts`: return `default_content` + `custom_content` fields. Add optional `role` parameter for resolved view (returns full cascaded result for a role chain). Update filename validation for `{role}/{filename}` paths.
- [x] 5.3 Update `src/tools/actions/proposeConfigUpdate.ts`: accept `{role}/{filename}` paths, support creating new files in role directories. Update filename validation.
- [x] 5.4 Write tests for updated MCP tools

## 6. Update Home Tab

- [x] 6.1 Update `buildConfigurationSection()` in `src/slack/homeTab.ts`: replace per-file rows with per-directory summary lines showing file counts and customization status (e.g., `user/ — 5 default, 2 custom`). Include per-repo instruction lines after role directories.
- [x] 6.2 Update or create tests for `buildConfigurationSection()`: verify per-directory summary output, verify repo lines appear after role directories, verify hidden for non-editors

## 7. Update Shipped Instructions (admin/config-updates.md)

- [x] 7.1 Update `data/default_configuration/admin/config-updates.md` to include smart file placement guidance: teach Claude to analyze existing files and decide whether to merge, create new, or ask the user
- [x] 7.2 Include guidance for the resolved view capability: how admins can ask to see what a role receives or compare default vs customized
- [x] 7.3 Verify shipped instruction content by writing a smoke test that resolves instructions for each role chain (`["user"]`, `["user", "dev"]`, `["user", "admin"]`, `["user", "dev", "admin"]`) and asserts expected files are present/absent in the output

## 8. Migration

- [x] 8.1 Create a blocking boot migration that splits existing `data/configuration/` flat files into the new directory structure. The migration should: read existing flat override files, use Claude to split them into topic files matching the new structure, write split files to role directories, move originals to `data/configuration/.backup-pre-cascade/`
- [x] 8.2 Register the migration in `src/migrations/index.ts` with appropriate version number and file access list
- [x] 8.3 Write migration tests

## 9. Docker & Deployment

- [x] 9.1 Update `.dockerignore` if needed for new directory structure
- [x] 9.2 Verify Dockerfile copies `data/default_configuration/` with subdirectories correctly
- [x] 9.3 Run full test suite to confirm no regressions across all updated modules

## Why

Repository-specific instructions for the changes workflow are currently limited to a single `pullRequestInstructions` field in `config.json` that points to a file inside the cloned repo. This has several limitations: it can't be edited via the admin UI, it only covers PR creation (not the full execution phase or worktree setup), and it doesn't follow the established two-tier resolution pattern used by all other instruction files.

## What Changes

- Add convention-based repo instruction files: `{repo-name}_changes_instructions.md` and `{repo-name}_worktree_setup_instructions.md`
- These follow the existing two-tier resolution chain (`data/configuration/` > `data/default_configuration/`)
- `_changes_instructions.md` is injected into the execution system prompt when Clack works on changes (replaces the PR instructions concept)
- `_worktree_setup_instructions.md` is run as a setup step after `git worktree add` for fresh worktrees only (not on resume)
- **BREAKING**: Remove `pullRequestInstructions` from `RepositoryConfig` — its responsibilities are absorbed by `_changes_instructions.md`
- Remove `changesWorkflow.prInstructions` from global config (same reason)
- Dynamic instruction file list: `listInstructionFiles()` generates repo-specific entries from `config.repositories` instead of a hardcoded list
- Admin UI automatically shows edit buttons for repo instruction files

## Capabilities

### New Capabilities
- `repo-instruction-files`: Convention-based per-repository instruction files for the changes workflow, with two-tier resolution and admin UI editing

### Modified Capabilities
- `instruction-system`: File list becomes dynamic (generated from repository config), adds repo-scoped filenames
- `changes-workflow`: Execution phase uses `_changes_instructions.md` instead of `pullRequestInstructions`; adds worktree setup step
- `admin-edit-instructions`: File listing includes dynamically generated repo instruction files

## Impact

- `src/configurationFiles.ts` — `INSTRUCTION_FILES` list becomes dynamic, generated from repo config
- `src/config.ts` — Remove `pullRequestInstructions` from `RepositoryConfig`, remove `prInstructions` from `ChangesWorkflowConfig`
- `src/changes/execution.ts` — Replace `resolvePRInstructions()` with instruction file resolution; add changes instructions to execution system prompt
- `src/changes/workflow.ts` — Add worktree setup step after `createWorktree()`, update `executeChange` call
- `src/slack/homeTab.ts` — No code changes needed (already iterates `listInstructionFiles()`)
- `data/config.json` — Remove `pullRequestInstructions` from repo entry

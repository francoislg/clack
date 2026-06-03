## Why

Per-repo instruction files (`{repo}/changes_instructions.md`, etc.) can be *listed* via `list_config_files` and *applied* by the config-update handler (which already validates writes against repository directories), but Claude has no way to **read or propose** edits to them: `read_config_file` and `propose_config_update` address files only through a fixed `role` enum (`user`/`dev`/`admin`/`owner`), so a repo name is rejected at the schema layer. Admins must drop to the Home Tab UI. Closing this gap lets admins edit a repo's changes/setup/install instructions conversationally, the same way they edit role instructions.

## What Changes

- Add a mutually-exclusive **repo addressing mode** to `read_config_file` and `propose_config_update`: callers pass either `{ role, topic?, file }` (existing) **or** `{ repo, file }` (new). `topic` is invalid in repo mode.
- In repo mode, `file` is constrained to a fixed enum of the three per-repo **markdown** instruction files: `changes_instructions.md`, `worktree_setup_instructions.md`, `worktree_install_instructions.md`. (`worktree_dirty_ignore.txt` is intentionally excluded — non-markdown globs file.)
- Validate `repo` at the tool layer against configured repositories; reject unknown repos.
- Extend `list_config_files`'s per-repo listing to include `worktree_install_instructions.md` (currently only the first two are surfaced) so the discoverable set matches what the tools can edit.
- append / replace / delete semantics, the staging + confirmation flow, auto-execute, and admin/owner role gating all carry over unchanged to repo-mode files.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `config-update-via-chat`: `read_config_file` and `propose_config_update` gain a repo addressing mode (`{ repo, file }`) with a fixed file enum and repo-existence validation; `list_config_files` surfaces the third per-repo markdown file.

## Impact

- `src/tools/query/configFieldSchemas.ts` — new repo-file enum + path builder; schema refinement for role-XOR-repo.
- `src/tools/query/readConfigFile.ts`, `src/tools/actions/proposeConfigUpdate.ts` — accept the repo branch.
- `src/configurationFiles.ts` — `getRepoEntries()` adds `worktree_install_instructions.md`; confirm `readInstructionFile`/`writeInstructionFile` resolve `{repo}/{file}` paths (the doc comment already claims repo-path support).
- No change to the apply/confirmation handler (already validates repository directories) beyond test coverage.
- Tests: schema validation, repo-mode read/propose, repo-existence rejection, list inclusion.

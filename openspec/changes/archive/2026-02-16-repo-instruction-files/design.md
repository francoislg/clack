## Context

The instruction system uses convention-based filenames (`instructions.md`, `dev_instructions.md`, etc.) resolved through a two-tier chain: `data/configuration/` overrides `data/default_configuration/`. The admin UI lists these files from a hardcoded array and lets admins edit them via Slack modals.

The changes workflow has a separate mechanism for PR instructions: a `pullRequestInstructions` field on `RepositoryConfig` pointing to a file inside the cloned repo, plus a global `changesWorkflow.prInstructions` fallback. This doesn't participate in the two-tier resolution or admin UI.

## Goals / Non-Goals

**Goals:**
- Per-repository instruction files for the changes workflow (execution + worktree setup)
- Follow the existing two-tier resolution pattern
- Editable via admin UI (same as role instructions)
- Replace `pullRequestInstructions` and `changesWorkflow.prInstructions`

**Non-Goals:**
- Per-repo instructions for the Q&A flow (all repos are available simultaneously there)
- Variable interpolation in repo instruction files (plain markdown, no `{VARIABLE}` support needed)
- Auto-detecting repo names from the filesystem (we use `config.repositories` as the source of truth)

## Decisions

### 1. Naming convention: `{repo.name}_changes_instructions.md` and `{repo.name}_worktree_setup_instructions.md`

Uses the repo `name` field from config (e.g., `applauz-monorepo`). This is already a filesystem-safe identifier used for clone directories.

**Alternative considered:** Nested directories like `repos/applauz-monorepo/changes.md`. Rejected because the existing instruction system is flat-file based, and the admin UI/resolution chain assumes flat filenames.

### 2. Dynamic file list generated from `config.repositories`

`listInstructionFiles()` currently iterates a hardcoded `INSTRUCTION_FILES` array. Instead, it will build the list dynamically: the static role files + generated repo-specific filenames from `getConfig().repositories`.

This means adding/removing a repository in config automatically updates the admin UI — no code changes needed.

### 3. Worktree setup as a separate Claude invocation

After `createWorktree()`, if `{repo}_worktree_setup_instructions.md` resolves, run a short Claude invocation with those instructions as the prompt. This runs with `Bash`, `Write`, `Edit`, `Read` tools (needs shell access for things like `cp`, `npm install`, etc.) and a short timeout (2 minutes).

Only runs for fresh worktrees — skipped when resuming an existing one.

### 4. Changes instructions injected into execution system prompt

The `EXECUTION_SYSTEM_PROMPT` in `execution.ts` gets the contents of `{repo}_changes_instructions.md` appended as a "Repository-Specific Instructions" section. This replaces the `prInstructions` parameter on `executeChange()`.

The same instructions are also available during PR body generation (in `pr.ts`), since they may contain PR formatting guidance.

### 5. Remove `pullRequestInstructions` and `changesWorkflow.prInstructions`

Both are fully replaced by `_changes_instructions.md`. The config fields are removed from types and parsing. The `resolvePRInstructions()` function is replaced by a call to `resolveInstructionFile()`.

## Risks / Trade-offs

**Breaking config change** → Users with `pullRequestInstructions` in their repo config need to migrate content to a `{repo}_changes_instructions.md` file. Mitigation: the field is simply removed; if present, it's ignored (config parsing already uses type assertions that skip unknown fields).

**Worktree setup timeout** → Setup instructions could take longer than expected (e.g., large `npm install`). Mitigation: 2-minute timeout with clear error message. Can be adjusted later if needed.

**Repo names with special characters** → If a repo name contains characters invalid for filenames, the instruction file can't be created. Mitigation: repo names are already used as directory names for clones, so this is an existing constraint.

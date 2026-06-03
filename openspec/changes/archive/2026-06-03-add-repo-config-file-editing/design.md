## Context

`read_config_file` and `propose_config_update` address instruction files via semantic fields whose `role` is a strict `z.enum(["user","dev","admin","owner"])` (`src/tools/query/configFieldSchemas.ts`), and build the path with `buildInstructionPath(role, topic, file) → "{role}/{file}"`. A repo name can't pass the enum, so per-repo files are unreachable from chat — even though:

- `readInstructionFile`/`writeInstructionFile` (`src/configurationFiles.ts`) already resolve `{repo}/{file}` paths (the doc comment explicitly notes 2-segment repo-path support, and `writeInstructionFile` only guards against traversal).
- The apply handler already "validates the file path is within a known role **or repository** directory" per the `config-update-via-chat` spec.
- `list_config_files` already surfaces a `repos` array via `getRepoEntries()`.

So the gap is narrow: the **addressing schema** of the two tools, plus one missing file in the listing.

The per-repo file set is also currently **implicit and duplicated** — `getRepoEntries()` hardcodes `["changes_instructions.md", "worktree_setup_instructions.md"]` inline, while `execution.ts`/`workers/*` reference the same names as scattered string literals. The user wants one authoritative list so no consumer drifts.

## Goals / Non-Goals

**Goals:**
- A single centralized constant for the editable per-repo instruction files, imported by every consumer (schema enum, `getRepoEntries`, future call sites).
- Repo addressing mode `{ repo, file }` on `read_config_file` and `propose_config_update`, mutually exclusive with role mode.
- Reject unknown repos and out-of-enum files at/near the schema layer.
- `list_config_files` lists all three editable markdown files per repo.

**Non-Goals:**
- Editing `worktree_dirty_ignore.txt` (non-markdown globs; excluded).
- Any change to append/replace/delete semantics, the confirmation/auto-execute flow, or role gating — these are reused as-is.
- Refactoring the scattered string literals in `execution.ts`/`workers/*` to consume the constant (nice-to-have, but those reference files beyond the editable set — e.g. the `.txt`; left out of scope to keep the change tight, noted as a follow-up).

## Decisions

### 1. Centralized source of truth: `REPO_INSTRUCTION_FILES`

Define one constant — the editable per-repo markdown files — and derive everything from it:

```ts
// src/tools/query/configFieldSchemas.ts (or a shared module)
export const REPO_INSTRUCTION_FILES = [
  "changes_instructions.md",
  "worktree_setup_instructions.md",
  "worktree_install_instructions.md",
] as const;
export type RepoInstructionFile = (typeof REPO_INSTRUCTION_FILES)[number];
export const REPO_FILE_ENUM = z.enum(REPO_INSTRUCTION_FILES);
```

Consumers:
- `REPO_FILE_ENUM` → the `file` field in repo mode for both tools.
- `getRepoEntries()` in `configurationFiles.ts` → iterate `REPO_INSTRUCTION_FILES` instead of its inline array (this is the change that surfaces the third file in `list_config_files`).

*Alternative considered:* keep the list inline in each spot. Rejected — that's exactly the drift the user wants to eliminate.

*Placement note:* `configFieldSchemas.ts` already hosts the shared schemas and is imported by both tools; putting the constant there avoids a new module. If `configurationFiles.ts` importing from `tools/query/` creates an undesirable dependency direction, hoist the constant to a neutral module (e.g. `src/repoInstructionFiles.ts`) and have both import it. Decide at implementation time based on the existing import graph; the constant location is an implementation detail, its singularity is the requirement.

### 2. Schema shape: role XOR repo, one tool each (not new tools)

Per the user's framing, extend the existing tools rather than adding new ones. Make `role` optional, add optional `repo`, and refine:

- exactly one of `role` / `repo` must be present;
- if `repo` present: `topic` must be absent, and `file` must satisfy `REPO_FILE_ENUM`;
- if `role` present: existing rules (`FILE_PATTERN`, optional `topic`) apply.

Path building branches: repo mode → `{repo}/{file}`; role mode → existing `buildInstructionPath`. A small `buildConfigPath(args)` helper centralizes this so both tools resolve identically.

*Alternative considered:* a discriminated union via a `mode` field. Rejected — presence-based XOR keeps the existing role-mode call sites byte-for-byte compatible and reads naturally for Claude.

*Alternative considered:* separate `read_repo_config_file` / `propose_repo_config_update` tools. Rejected — doubles the tool surface and the user explicitly asked for it inside `propose_config_update`.

### 3. Repo-existence validation at the tool layer

The `file` enum is static, but valid repo names are dynamic (`config.repositories`). Zod can't enum them, so validate inside the tool handler: if `repo` is not a configured repository, return `errorResult` listing valid repos (no intent staged). This mirrors how the apply handler validates repository directories and prevents creating stray `data/configuration/<garbage>/` dirs.

### 4. Reuse the apply path unchanged

The staged intent shape (`{ type: "config_update", operation, file, content? }`) already carries a plain path string; `{repo}/{file}` flows through it identically to `{role}/{file}`. The apply handler already accepts repository directories, so no handler change — only added test coverage to lock the behavior in.

## Risks / Trade-offs

- **Import-direction coupling** (`configurationFiles.ts` → `tools/query/configFieldSchemas.ts`) → Mitigation: if it inverts a clean layering, hoist the constant to a neutral leaf module; both import it.
- **Repo files have no shipped default**, so `delete` always means "delete custom-only file" (no revert-to-default) → already handled by existing delete semantics (status `will_delete_custom_only`); no special-casing needed, just verified by a test.
- **Constant drift with the worktree-setup code** (`execution.ts`/`workers/*` still use literals, including the `.txt`) → Accepted for this change; those reference a superset (incl. non-editable files). Noted as a follow-up so the editable-file constant stays the authoritative one for *editing*.
- **Schema XOR ergonomics** → a clear refinement error message ("provide exactly one of `role` or `repo`") keeps Claude from fumbling the call.

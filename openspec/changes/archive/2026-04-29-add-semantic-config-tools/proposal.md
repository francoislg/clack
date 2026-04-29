## Why

The three admin config-management MCP tools (`list_config_files`, `read_config_file`, `propose_config_update`) currently address files via a single path-string field (e.g., `"dev/something.md"`). This has two problems:

1. **Topic files are unreachable.** The disk layout supports `{role}/topics/{topic}/{filename}.md` for topic-scoped instructions (loaded only when an integration's topic is attached at runtime). The cascading resolver walks them, the Home Tab functions exist (`listRoleTopicDirFiles`, `readRoleTopicFile`), but the MCP tools all hardcode a `parts.length !== 2` check that rejects topic paths. Admins can read/edit baseline files via chat but not topic files — they have to fall back to the Home Tab or direct disk edits.

2. **Path strings can't be statically validated.** Role names are a closed set of four (`user`, `dev`, `admin`, `owner`), but the schema today is `z.string()` so `"developer/foo.md"` only fails at runtime. Path traversal (`"../../etc/passwd"`) is caught only by `writeInstructionFile`'s `startsWith(configDir)` check, not at the schema boundary.

Switching to discrete semantic fields (`role`, `topic`, `file`) closes the topic gap and lets the schema enforce role-enum and safe-name patterns up front.

## What Changes

- **`read_config_file`**: replace the single `file` parameter with `{ role: enum, topic?: string, file: string }`. Drop the resolved-view trick (where passing `"dev"` as `file` returned the cascaded view) — it's incompatible with the new schema and was a magic overload. Resolved-view stays out of scope; if needed later it gets its own focused tool.

- **`propose_config_update`**: replace the single `file` parameter with `{ role: enum, topic?: string, file: string }`. The `content` and `operation` parameters stay unchanged.

- **`list_config_files`**: replace path-keyed output with semantic structure. Each role entry carries a `files` array (baseline) and a `topics` array (topic-scoped, grouped by topic name). Repos remain a flat list as today.

- **Schema validation**:
  - `role`: `z.enum(["user", "dev", "admin", "owner"])` — closed set
  - `topic`: `z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i)` — open set, but rejects `..`, `/`, leading punctuation
  - `file`: `z.string().regex(/^[\w][\w.-]*\.md$/)` — bare filename, must end `.md`, no slashes

- **Path-traversal defense in depth**: `writeInstructionFile`'s existing `startsWith(configDir)` check stays as the security boundary, but the schema patterns make most invalid input fail before reaching it.

- **Update the resolved-view `apply_config_update` action handler** in `src/slack/handlers/applyConfigUpdate.ts` (or wherever it lives) — the staged intent stores a `file` path that's used by `writeInstructionFile`, so the intent shape needs to switch from `{ file }` to `{ role, topic?, file }` (or pre-compose the path internally and keep the intent as a single path — TBD in design).

- **Update Claude's instruction files** in `data/default_configuration/admin/` (and possibly `data/default_configuration/dev/`) to teach the new semantic call shape. Without this, Claude continues calling the tools the old way and gets schema errors.

- **Topics with no on-disk files yet**: `propose_config_update` accepts arbitrary topic names (subject to the safe-name regex). Writing creates `data/configuration/{role}/topics/{topic}/{file}.md` via `mkdir -p`. This means an admin can create the very first file for a brand-new topic from chat — no manual filesystem prep needed.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `config-update-via-chat`: replaces the path-string addressing in `read_config_file`, `propose_config_update`, and `list_config_files` with semantic fields. Adds topic-scoped read/write/list. Removes the resolved-view magic overload.
- `cascading-config-resolver`: tightens the `Topic File Discovery in Home Tab` requirement — listings now expose topic files under semantic fields rather than path-prefixed entries (the spec text currently mandates path-style entries like `user/topics/metabase/metabase.md`).

## Impact

- **Code**:
  - `src/tools/query/listConfigFiles.ts` — output shape change
  - `src/tools/query/readConfigFile.ts` — schema change, drop resolved-view branch
  - `src/tools/actions/proposeConfigUpdate.ts` — schema change, validation update
  - `src/configurationFiles.ts` — `listInstructionFiles` may need to fold in topic listings (or a new function); `readInstructionFile` and any helpers that take path strings need to accept semantic fields or expose new variants
  - `src/slack/handlers/applyConfigUpdate.ts` (or equivalent button handler) — intent payload shape; verify it still resolves to the correct write path
  - `src/tools/types.ts` — any shared types touching the listing structure
- **Tests**: new and updated cases in `listConfigFiles.test.ts`, `readConfigFile.test.ts`, `proposeConfigUpdate.test.ts`. New cases for topic paths (read existing, propose append, propose replace, propose new file in new-topic-with-no-default).
- **Configuration**: `data/default_configuration/admin/*.md` — teach Claude the new call shape. Likely a new file `topic-config-edits.md` or extending `config-updates.md`.
- **Breaking change scope**: these tools are admin/owner-only and consumed by Claude through the system prompt. No external consumer. Updating the prompt instructions in lockstep with the code is the entire migration.
- **Risk**: Claude may briefly call the old shape before instruction updates propagate (cached prompts, mid-session). Schema errors are clear enough that Claude can self-correct on retry. No data loss path.

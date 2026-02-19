## Context

Admin users can update instruction/configuration files via chat using `propose_config_update`. Currently, this tool requires Claude to output the entire file content for every update — even when the admin only wants to append a line. Claude also has no tool to read the current file before proposing changes (it can only list filenames via `list_config_files`). This leads to fragile updates where Claude can hallucinate or drop content.

## Goals / Non-Goals

**Goals:**
- Add `read_config_file` tool so Claude can see current content before editing
- Make append the default operation for `propose_config_update`
- Support full replacement for removals/rewrites as an explicit opt-in
- Keep both tools admin/owner-gated

**Non-Goals:**
- Granular section-level editing (find-and-replace, regex, etc.)
- Version history or rollback for config files
- Changing the confirmation flow (still requires button click)

## Decisions

### Decision 1: Separate read tool rather than embedding content in list_config_files

**Choice**: Add a dedicated `read_config_file(file)` tool.

**Rationale**: `list_config_files` returns metadata (filename, status). Embedding file content would bloat the response when Claude just wants to browse available files. A separate read tool follows the existing pattern (list → read → act).

### Decision 2: Append by default via `operation` parameter

**Choice**: Add `operation?: "append" | "replace"` to `propose_config_update`, defaulting to `"append"`.

**Rationale**: Most config edits are additions ("add this rule", "add this instruction"). Append-by-default makes the common case safe — Claude only provides the addition, and the tool handles reading the current content and concatenating. Full replacement is available via `operation: "replace"` for the rare removal case.

**Alternative considered**: Separate `append_config` and `replace_config` tools. Rejected — one tool with an operation parameter is simpler and avoids tool proliferation.

### Decision 3: Remove first-override seeding logic

**Choice**: Remove the special-case seeding in `proposeConfigUpdate.ts:38-44`.

**Rationale**: The append operation naturally handles this case. When appending to a file with no custom override, the tool reads the default content and appends to it — producing the same result as the current seeding logic but through a general-purpose mechanism.

## Risks / Trade-offs

- [Risk] Claude forgets to use `read_config_file` before a replace operation → **Mitigation**: Tool description and admin instructions will emphasize "read before replace". Append doesn't need a prior read since the tool handles concatenation internally.
- [Risk] Append could produce duplicate content if Claude calls it twice → **Mitigation**: The confirmation flow (button click) already prevents accidental double-application. The preview shows the full resulting content.

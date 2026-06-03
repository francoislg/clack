## Why

Admins can list instruction/configuration files (`list_config_files`) and read one at a time (`read_config_file`), but there is no way to find *where* a given string lives across the config set. Answering "which instruction file mentions the stop reaction?" today means reading files one-by-one. A content search collapses that manual loop into a single call.

## What Changes

- Add an optional `query` parameter to the existing `list_config_files` MCP tool (no new tool).
- When `query` is omitted, behavior is unchanged — the full listing is returned and no file content is read (backward-compatible).
- When `query` is provided, `list_config_files` case-insensitively substring-searches the content of every file in the listing, keeping only files that match. Each surviving file entry is annotated with its hits (layer + line number + snippet); roles, topics, and repos with no surviving files are dropped.
- Search covers the full listing — role baseline files, role topic files, pre-analysis files, and per-repo instruction files — by reconstructing each file's path and reading it through the existing `readInstructionFile` resolver.
- Both content layers are searched independently; each hit is tagged with its layer (`default` or `custom`).
- A query that matches nothing returns an empty listing (empty `roles`/`preAnalysis`/`repos`), not an error.
- Out of scope: `config.json` / `mcp.json` / tool_mapping configs (those belong to the separate `admin-config-tools` capability and are not instruction files).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `config-update-via-chat`: the `list_config_files` tool requirement gains an optional content-search mode (`query` parameter) that filters and annotates the listing with per-file match hits.

## Impact

- Modified: `src/tools/query/listConfigFiles.ts` (+ test) — add optional `query` param and the filter/annotate path.
- Reuses `listInstructionFiles()` and `readInstructionFile()` from `src/configurationFiles.ts` — no new file I/O or path-safety surface (paths originate from the trusted listing, never from Claude input).
- No new tool registration — `list_config_files` is already gated to admin+ in `src/tools/server.ts`.
- No config schema, migration, or dependency changes.

## Context

`list_config_files` (`src/tools/query/listConfigFiles.ts`) currently takes no input and returns the structure produced by `listInstructionFiles()` (`src/configurationFiles.ts`): `{ roles[], preAnalysis[], repos[] }`, where each `FileEntry` is `{ file, status }`. It never reads file *content*. `read_config_file` reads one file's content (both `default_content` and `custom_content`) via `readInstructionFile(path)`, which path-resolves through `readRoleFile` / `readRoleTopicFile` in `cascadingConfigResolver.ts`.

Both tools are gated to admin/owner in `src/tools/server.ts` inside the `canEditConfig(ctx.role)` block. The capability is `config-update-via-chat`.

The goal is to let an admin search a string across all instruction files in one call. Rather than a new tool, this extends `list_config_files` with an optional `query` parameter.

## Goals / Non-Goals

**Goals:**
- One call answers "where does string X appear across all instruction config files."
- Reuse the existing listing + read primitives; add no new file I/O or path-safety surface.
- Backward-compatible: no `query` ⇒ identical behavior and output to today.
- Each hit is locatable: layer (`default`/`custom`) + line number + snippet.

**Non-Goals:**
- Searching `config.json` / `mcp.json` / tool_mapping (separate `admin-config-tools` capability).
- Regex / case-sensitive modes (case-insensitive substring only; can be added later).
- A separate `search_config_files` tool (explicitly rejected in favor of extending the existing tool).
- Changing the role gating or adding new registration.

## Decisions

### Extend `list_config_files`, don't add a tool
The user prefers a single tool. `list_config_files` already enumerates exactly the file set we want to search, and its output shape (roles → files/topics, pre-analysis, repos) is the natural container for annotated results. A `query` param keeps the "list configs" mental model: with no query you list everything; with a query you list the subset that contains it.

*Alternative considered:* a dedicated `search_config_files` returning a flat `matches[]`. Rejected — duplicates the enumeration logic and splits "browse configs" across two tools.

### Path reconstruction drives content reads
`listInstructionFiles()` returns entries grouped by container but not full paths. The search path reconstructs each file's path from its container and feeds it to `readInstructionFile`:
- role baseline → `{role}/{file}`
- role topic → `{role}/topics/{topic}/{file}`
- pre-analysis → `pre-analysis/{file}`
- repo → `{repo}/{file}`

`readInstructionFile` accepts all of these: 2-segment paths resolve via `readRoleFile` (which is purely path-based — first segment is just a directory name, so `pre-analysis` and repo names work), and 4-segment topic paths via `readRoleTopicFile`. No new resolver needed.

*Note:* paths are built from the trusted listing, never from Claude input — so the existing traversal guards on the write/delete side are not in play here.

### Output shape: filter + annotate the existing structure
Keep `{ roles, preAnalysis, repos }`. When `query` is set:
- For each file, read both layers, scan each non-null layer for case-insensitive substring hits, collect `{ layer, line, snippet }` per hit (snippet = the matching line, trimmed/bounded).
- Attach `matches: MatchHit[]` to the file entry; drop file entries with zero hits.
- Drop topics, roles, and repo groups left with no files.
- Add a top-level `summary: { query, files, hits }`.

When `query` is omitted, return today's shape verbatim (no `matches` field, no `summary`).

*Alternative considered:* return only a filtered file-name list (no snippets). Rejected — the whole value of the feature is locating the hit; the earlier exploration confirmed per-file snippets are wanted.

### Matching semantics
Case-insensitive substring (`content.toLowerCase().includes(query.toLowerCase())`, line-by-line for line numbers). Snippet is the full matching line; bound overly long lines to a reasonable length. Multiple hits in one file all reported. An all-whitespace/empty `query` is treated as "no query" (returns the full unfiltered listing) to avoid a degenerate match-everything.

## Risks / Trade-offs

- [Reading every file on each query is O(files)] → The instruction-file set is small (tens of files); acceptable. No caching needed.
- [Snippet could leak nothing sensitive new] → All content is already readable by the same admin via `read_config_file`; gating is unchanged, so no new exposure.
- [Output shape grows a conditional `matches`/`summary` field] → Documented in the spec; consumers that ignore unknown fields are unaffected, and the no-query path is byte-identical to today.

## Open Questions

- None blocking. Snippet length bound and whether to include a per-file hit count are minor and settled in tasks.

## Context

- `upload_file` (`src/tools/query/uploadFile.ts`) takes only inline `content` (500 KB cap). A file already on disk can reach Slack only by being read into context and re-typed as tool input, which is bounded by the 64k output-token limit — the 2026-09-29 incident (proposal).
- External MCP servers are spawned per session: `prepareMcpSession` (`src/claude/mcpServerManager.ts`) loads each server config through `loadMcpServer`, and `substituteEnvVars` (`src/mcp.ts:362`) expands `${VAR}` from `process.env` only.
- `@jerichosequitin/metabase-mcp` writes exports to `EXPORT_DIRECTORY` (default `~/Downloads/Metabase`), creates the folder itself, and returns `{ file_path, row_count, file_size_bytes, preview_data }`.
- Transient files written today: Metabase exports (external process), tester recordings — `webm` by the Playwright sidecar (external process), `mp4` by `record_and_upload`'s ffmpeg call next to it. Neither is ever deleted. gemini-image and error-report uploads use in-memory buffers.
- `data/` is the persistent mount on the VM (`/app/data`); `data/state/*.json` are graceful-zod persisted state; `src/stateBackup.ts` already runs a DST-aware local-midnight scheduler with a boot catch-up.
- Plugin tools receive no session context through the SDK.

## Goals / Non-Goals

**Goals:**

- A file on disk reaches Slack without passing through Claude's context.
- Every transient output file lives in a Clack-managed root, is tagged when it's created (or discovered), and is deleted after a bounded, configurable time.
- Uploads by path are confined to the caller's own files.
- One creation API for all internal writers (core + plugins).

**Non-Goals:**

- Managing state, sessions, worktrees, backups, repositories, or migrations' data.
- Changing how external MCP servers write — they are only pointed at a folder.
- Letting Claude write arbitrary files (query mode stays read-only).
- Cleanup of Slack-side copies.

## Decisions

### D1. Per-session folder under `data/downloads/`

`data/downloads/<sessionId>/` for query sessions. The session is the unit that owns a thread's files: a follow-up in the same thread can reuse an export ("also post it to #finance"), and one session can never reach another's files.

- _Alternative — per-run folder deleted at run end:_ exact "done" signal, but a follow-up can't reuse the file and nothing is auditable afterwards.
- _Alternative — one shared folder:_ no attribution, so path uploads couldn't be confined per user.

### D2. Session-aware placeholder `${CLACK_SESSION_DOWNLOADS_DIR}`

`mcp.json` is parsed once and cached, so the placeholder can't be resolved at parse time: `substituteEnvVars` leaves `${CLACK_SESSION_DOWNLOADS_DIR}` literal, and `resolveSessionPlaceholders(config, dir)` replaces it in stdio `env` / sse-http `headers` wherever a config enters a session — `prepareMcpSession` (always-on, resumed, pre-attached; it also creates the session folder) and `McpServerManager.attach` (mid-session attaches). Loads outside a session (boot diagnose, `testMCP`, the startup baseline smoke) resolve it to `data/downloads/_system/`.

- _Alternative — a global `CLACK_DOWNLOADS_DIR` in `process.env`:_ no per-session attribution (D1).
- _Alternative — Docker volume mapping over `~/Downloads`:_ fixes only the container; local runs would still write to the operator's real Downloads.

### D3. One core module owns managed files

New `src/managedFiles/` with:

- `roots` — registered managed roots: `downloads` (`data/downloads`) and `recordings` (`config.tester.recordingsDir`, whenever it is configured — disabling the tester doesn't stop existing recordings from aging out). The sweep and every API call refuse paths outside a registered root (realpath-resolved).
- `createFile({ root, owner, name, data })` — writes the bytes and tags the file (`createdAt` = now).
- `reservePath({ root, owner, name })` — returns a tagged, not-yet-existing path for an external process to write (ffmpeg). The entry is dropped by the sweep if the file never appears.
- `resolveOwnedFile({ owner, path })` — realpath + containment in the owner's folder, returns the real path or an error (used by `upload_file`).
- `markUploaded(path, { fileId, permalink })`.
  Name collisions get a numeric suffix; names are sanitized to a basename.
- _Alternative — each tool manages its own files:_ the status quo; retention and audit would be reimplemented per tool.

### D4. Plugins create files through `sdk.files`

`sdk.files.create(name, data)` / `sdk.files.reservePath(name)` delegate to D3 with owner `plugin:<pluginName>` in the `downloads` root. Plugins upload their own files through the SDK's Slack surface; `upload_file`'s `file_path` accepts only the caller session's folder, so plugin files aren't reachable by Claude by path. The boundary guard keeps plugins from importing `src/managedFiles/` directly.

- _Alternative — session-owned plugin files:_ plugin tools have no session context today; adding it is a separate change.

### D5. Ledger `data/state/file-ledger.json`

Array of `{ path, root, owner, createdAt, uploadedAt?, fileId?, permalink?, channel?, threadTs? }` (paths relative to the root). Persisted through the existing `createArrayStore` (`src/state/resilientStore.ts`) with a per-entry zod schema: a malformed entry is quarantined (surfaced in the Home Tab quarantine panel and DMed to the owner, like other resilient stores) while the rest load; writes are ordered by the repo's local `serialize()` write-chain pattern (as in `src/emojiLore.ts`). It's covered by the existing state backup (`data/state/`).

- _Alternative — a bespoke graceful reader/writer:_ re-implements what `createArrayStore` already provides, with weaker failure handling (a single bad entry would empty the whole ledger).
- _Alternative — sidecar `<file>.clack.json` per file:_ doubles the file count in folders external tools write into, and an audit query has to walk the tree.

### D6. External writes are discovered, not intercepted

Clack can't hook another process's writes. The sweep (and `resolveOwnedFile`) tag any untagged file in a managed root: `createdAt` = its mtime, owner = its session folder (downloads) or `tester` (recordings). This is how Metabase exports and sidecar `webm`s enter the ledger.

### D7. Retention sweep

Daily at local midnight (reusing `stateBackup`'s scheduling helpers) and once at boot. Per root, per file: uploaded → delete when `uploadedAt + keepUploaded` has passed; not uploaded → delete when `createdAt + keepUnuploaded` has passed. Owners with a live run are skipped: a session owner is live when its persisted session's channel + threadTs has a run in `activeRuns` (the sessionId's embedded ts is the triggering message, which differs from the thread for a session started by a thread reply, so it isn't used); the recordings owner is live while the tester slot is held. Ledger entries whose file is gone are dropped; empty owner folders are removed. Every deletion is logged.
Config (fail-fast zod, optional): `managedFiles.retention.<root> = { keepUploadedHours, keepUnuploadedHours }`. Defaults: downloads 168 h / 24 h; recordings 336 h / 24 h (see Open Questions).

- _Alternative — sweep hourly:_ no benefit at day-scale windows.

### D8. `upload_file` by path

Exactly one of `content` / `file_path`. `file_path` (absolute, or relative to the session folder) goes through `resolveOwnedFile`; then `stat` — not a regular file, empty, or over 50 MB → error without reading. The bytes are passed to `filesUploadV2` as `file`; `filename` defaults to the basename. A successful upload calls `markUploaded`. Inline `content` caps at 64 KB — about 20k output tokens, the point past which re-typing costs minutes; the error names `file_path`. The tool description says an export's result already carries its row count and a preview, so the file doesn't need to be `Read`; if it must be inspected, `Read` a slice (`offset`/`limit`).

- _Alternative — keep 500 KB inline:_ content that size can't be produced within one turn's output; the cap only postpones the failure to a 7-minute retry loop.

### D9. Tester recordings

`recordings` is a managed root. `record_and_upload` gets the mp4 path from `reservePath({ root: "recordings", owner: "tester", … })` and calls `markUploaded` after the Slack upload. The verify take stays until the sweep removes it under the root's `keepUnuploaded`.

### D10. Ops

`.gitignore` gains `data/downloads/`; `scripts/gceSync/manifest.ts` `RUNTIME_OWNED_PATHS` gains `data/downloads`. The ledger lives under `data/state/`, already runtime-owned.

## Risks / Trade-offs

- [A sweep bug deletes the wrong files] → deletion only inside realpath-resolved registered roots; unit tests cover containment (symlink escaping a root, `..` paths); every deletion logged.
- [A live session loses a file it's about to upload] → owners with a live run are skipped; a returning session past the window gets "File not found" and re-runs the export.
- [Ledger write races] → writes go through one serialized write chain; a malformed entry is quarantined rather than dropping the ledger, and its file is re-tagged by discovery (`createdAt` = mtime).
- [An external server ignores `EXPORT_DIRECTORY`] → its files land outside the managed root: not uploadable by path, not swept. Same as today; visible because `upload_file` rejects the path.
- [Inline cap drop breaks a 64–500 KB inline upload] → such uploads already risk the output limit; the error points to the replacement path.
- [Recordings start being deleted] → a behavior change for testers; defaults keep uploaded recordings two weeks, and the window is configurable.

## Migration Plan

1. Ship the code (no migration needed — the ledger starts empty; the first sweep discovers existing recordings with `createdAt` = mtime, so recordings older than the window are removed on the first sweep).
2. Coordinator pushes `data/mcp.json` with metabase `EXPORT_DIRECTORY: "${CLACK_SESSION_DOWNLOADS_DIR}"` (`gce-push --overwrite data/mcp.json`) and deploys.
3. An admin asks Clack to correct the Metabase topic instruction: exports land in the session's downloads folder; upload them with `upload_file(file_path)`; don't `Read` a whole export.
4. Old files under `/home/clack/Downloads/Metabase` inside the running container vanish with the container on the next deploy (not on the data disk).
   Rollback: redeploy the previous image; `mcp.json`'s placeholder then resolves to an empty string with a warning, so revert that line too.

## Resolved Questions

- **Recording retention:** 14 days after upload, 24 h for never-uploaded takes (the D7 defaults).
- **Pre-existing recordings:** dated by mtime on discovery like any external write, so ones already past the window go on the first sweep.

## Open Questions

- Worker-mode sessions (Changes Workflow) have no file-producing tools today; they get no downloads folder until one needs it.

## Why

In a DM, a Metabase export wrote a ~100 KB CSV to `~/Downloads/Metabase`. `upload_file` only accepts inline `content`, so Claude `Read` the whole file and tried to re-type it as tool input: three turns hit the 64k output-token limit (~7 min each) and the fourth uploaded 32 KB — about a third of the rows. The export result already carried the path, row count, size, and a preview; the only missing piece was a way to hand a file on disk to Slack.

Behind that gap sits a broader one: files Clack's tools produce have no home and no lifecycle. External MCP servers write wherever their defaults point (the operator's real `~/Downloads` when run locally), tester recordings accumulate in `data/tester/recordings/` forever, and nothing records which file was delivered where.

## What Changes

- **Clack-owned downloads folder.** `data/downloads/<sessionId>/` is the per-session home for transient output files — the same relative path locally and on the VM (the existing `/app/data` mount), never the operator's home directory.
- **Session-aware MCP env placeholder.** `mcp.json` env/header values can reference `${CLACK_SESSION_DOWNLOADS_DIR}`, resolved per session when the server config is loaded, so an external server (Metabase's `EXPORT_DIRECTORY`) writes into the session's folder.
- **Centralized file creation.** One core API creates every file an internal tool produces — core tools and plugins (via a new `sdk.files` member) alike. It writes (or reserves a path for an external process such as ffmpeg) inside a managed root and tags the file in a ledger at creation. Direct writes of transient outputs outside this API are not allowed.
- **File ledger.** `data/state/file-ledger.json` records each managed file: root, owner (session or tester run), `createdAt`, and — once delivered — `uploadedAt`, `fileId`, `permalink`. It doubles as an audit trail of which file went to which thread.
- **Discovery of external writes.** Files that appear in a managed root without a ledger entry (written by an external process) are tagged on discovery with `createdAt` = file mtime.
- **Retention sweep.** A daily sweep (plus one at boot) deletes managed files past their root's retention window — `keepUploaded` after `uploadedAt`, `keepUnuploaded` after `createdAt` — only inside registered managed roots, never for an owner with a live run. Windows are configurable per root.
- **`upload_file` uploads by path.** Accepts exactly one of `content` or `file_path`. `file_path` must resolve (symlinks followed) inside the calling session's folder; the file's size is checked before it is read (50 MB cap). Inline `content` is capped at 64 KB (**BREAKING** for inline content between 64 KB and 500 KB — such content can't be typed within one turn's output anyway) and the over-cap error points to `file_path`. A path upload records `uploadedAt`/`fileId`/`permalink` in the ledger.
- **Tester recordings become a managed root.** `data/tester/recordings/` is swept under its own retention; the mp4 transcode output is created through the central API. (**BREAKING**: recordings are no longer kept indefinitely.)
- **Ops.** `.gitignore` and the GCE sync's runtime-owned paths cover `data/downloads/`. The Metabase `EXPORT_DIRECTORY` line in `mcp.json` and the Metabase topic instruction (which names `Downloads/Metabase`) are updated on the VM after deploy — the instruction by asking Clack to correct it.

Out of scope: state, sessions, worktrees, backups, and repositories — these keep their own lifecycles and are never managed roots.

## Capabilities

### New Capabilities

- `managed-files`: managed roots, the per-session downloads folder, the session-aware MCP placeholder, the central file-creation API (core + `sdk.files`), the file ledger, discovery of external writes, and the retention sweep.

### Modified Capabilities

- `file-upload`: `upload_file` gains `file_path` (session-confined, size pre-check), the inline cap drops to 64 KB with an error pointing to `file_path`, and path uploads are recorded in the ledger.
- `test-recording`: recordings live in a managed root under retention; the mp4 is created through the central API; the verify take is no longer retained indefinitely.

## Impact

- **Code:** `src/tools/query/uploadFile.ts`; `src/mcp.ts` (`substituteEnvVars`) and `src/claude/mcpServerManager.ts` (per-session resolution); new core module for managed files + ledger + sweep; `src/plugins-sdk/sdk.ts` + `internal/factory.ts` (`sdk.files`); `src/tools/worker/recordAndUpload.ts`; `src/config.ts` / `configSchemas.ts` / `configZod.ts` (retention config); boot wiring in `src/index.ts`; `scripts/gceSync/manifest.ts` (`RUNTIME_OWNED_PATHS`); `.gitignore`.
- **Config:** new optional retention block (fail-fast zod, defaults when absent).
- **VM data (post-deploy, via the coordinator):** `data/mcp.json` metabase env gains `EXPORT_DIRECTORY` (pushed with `gce-push --overwrite data/mcp.json`); Metabase topic instruction corrected through `propose_config_update`.
- **Docs:** CLAUDE.md data-directory layout gains `downloads/` and the ledger.
- **Data exposure:** exports hold customer data; retention bounds how long it sits on the data disk, and the ledger shows where each copy went.

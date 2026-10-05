## 1. Config and paths

- [x] 1.1 Add `getDownloadsDir()` (`data/downloads`) and `getFileLedgerPath()` (`data/state/file-ledger.json`) beside the other path helpers in `src/config.ts`
- [x] 1.2 Add the optional `managedFiles.retention` block (`downloads`/`recordings` → `{ keepUploadedHours, keepUnuploadedHours }`, positive numbers) as a fail-fast zod schema in `configSchemas.ts`, wired through `configZod.ts` and the `Config` type; defaults 168/24 and 336/24 when absent; tests for defaults and rejected values
- [x] 1.3 Add `data/downloads/` to `.gitignore` and `data/downloads` to `RUNTIME_OWNED_PATHS` in `scripts/gceSync/manifest.ts` (+ its test)

## 2. Managed-files core (`src/managedFiles/`)

- [x] 2.1 `roots.ts`: registry of managed roots (`downloads` always; `recordings` whenever `config.tester.recordingsDir` is configured, enabled or not) and a realpath-based `resolveInRoot(root, path)` containment check; tests for `..`, symlink escape, a sibling-prefix folder, and `recordings` registered iff `recordingsDir` is configured (tester enabled or not)
- [x] 2.2 `ledger.ts`: per-entry zod schema persisted through `createArrayStore` (`src/state/resilientStore.ts`) — quarantine of malformed entries comes with it — plus the local `serialize()` write chain used by `src/emojiLore.ts`; tests with the store mocked at the boundary
- [x] 2.3 `createFile` / `reservePath`: owner folder creation, basename sanitizing, numeric-suffix collision handling, ledger entry with `createdAt`; tests
- [x] 2.4 `resolveOwnedFile({ owner, path })`: resolve relative to the owner folder, containment in that folder, discovery-tag an untagged file (`createdAt` = mtime); tests
- [x] 2.5 `markUploaded(path, { fileId, permalink, channel, threadTs })`; tests
- [x] 2.6 `sweep.ts`: discovery tagging, per-root windows, live-owner skip through injected probes (a `downloads` owner is live when its persisted session — loaded by sessionId, giving its channel + threadTs — has a run in `activeRuns.getByThread`; an owner whose session can't be loaded, `_system`, and `plugin:*` owners are not live; `recordings` is live while the tester slot is held), drop entries whose file is gone, remove empty owner folders, log each deletion, never touch paths outside a root; tests per spec scenario
- [x] 2.7 Sweep scheduler: daily at local midnight + once at boot, reusing `stateBackup`'s `computeNextBackupTime`; start/stop wired into `src/lifecycle.ts`; tests with `vi.useFakeTimers()` for the boot fire, the midnight fire, and start/stop

## 3. Session folder and MCP placeholder

- [x] 3.1 `substituteEnvVars` (`src/mcp.ts`) leaves `${CLACK_SESSION_DOWNLOADS_DIR}` literal in the cached config; `resolveSessionPlaceholders` / `resolveSessionPlaceholdersAll` replace it in stdio `env` and sse/http `headers`; tests
- [x] 3.2 `prepareMcpSession` creates `data/downloads/<sessionId>/` and resolves the always-on, resumed, and pre-attached configs; `McpServerManager.attach` resolves mid-session attaches; tests for two sessions resolving different folders
- [x] 3.3 Session-less loads (boot diagnose in `src/index.ts`, `testMCP`, the startup baseline smoke) resolve the placeholder to `data/downloads/_system/`; tests

## 4. `upload_file`

- [x] 4.1 Schema: `content` and `file_path` optional, `filename` optional; exactly-one check; `filename` required with `content`, defaulting to the basename with `file_path` (keep within the served-schema rules: no `.default()`, no `z.record`)
- [x] 4.2 Inline cap 64 KB with the error pointing to `file_path`
- [x] 4.3 Path source: `resolveOwnedFile` against the session's owner → `stat` (regular, non-empty, ≤ 50 MB) before reading → upload bytes as `file` → `markUploaded`; no `markUploaded` on Slack failure
- [x] 4.4 Tool description: export results carry row count + preview; don't `Read` an export to re-type it; `Read` slices (`offset`/`limit`) when inspection is needed
- [x] 4.5 Update `uploadFile.test.ts`: new scenarios per the `file-upload` delta (managed-files module mocked at the boundary)

## 5. Plugins and tester

- [x] 5.1 `sdk.files.create` / `sdk.files.reservePath` on the SDK façade (`src/plugins-sdk/sdk.ts`) implemented in `internal/factory.ts`, owner `plugin:<name>`; give `sdk.files` inert defaults in `createTestClackSdk` (`src/plugins-sdk/testHelpers.ts`) and extend trivia's `createFakeSdk`; boundary guard keeps plugins off `src/managedFiles/`
- [x] 5.2 `record_and_upload`: mp4 path from `reservePath({ root: "recordings", owner: "tester" })`, `markUploaded` after the Slack upload; update its tests
- [x] 5.3 Sweep live-owner probe for `recordings` reads the tester slot

## 6. Verification and docs

- [x] 6.1 Integration test (`*.integration.test.ts`): real temp root → create, discover, upload-by-path (Slack mocked), sweep deletes past-window files and spares a live owner
- [x] 6.2 `servedToolSchemas.integration.test.ts` passes with the new `upload_file` schema
- [x] 6.3 `npm test`, `npx tsc --noEmit`, `npx oxlint`, `npx oxfmt --check` on touched files
- [x] 6.4 CLAUDE.md: data-directory layout gains `downloads/` and `state/file-ledger.json`; a short "Managed files" section (roots, `sdk.files`, placeholder, retention config)
- [x] 6.5 `data/mcp.json.example` (if present) shows metabase `EXPORT_DIRECTORY: "${CLACK_SESSION_DOWNLOADS_DIR}"` — `data/mcp.example.json` has no metabase entry, nothing to update

## 7. Rollout (coordinator / operator)

- [ ] 7.1 Coordinator pushes `data/mcp.json` with the metabase `EXPORT_DIRECTORY` line (`gce-push --overwrite data/mcp.json`) and deploys
- [ ] 7.2 Admin asks Clack to correct the Metabase topic instruction (exports land in the session's downloads folder; upload with `upload_file(file_path)`; don't `Read` a whole export)
- [ ] 7.3 Live check: a Metabase export in a DM uploads by path within one turn, and its ledger entry shows `uploadedAt`

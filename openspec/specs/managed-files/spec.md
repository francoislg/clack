# managed-files Specification

## Purpose

Clack-owned transient output files: the managed roots they live in, the one creation path every internal tool uses, the ledger that tags each file, the per-session downloads folder external MCP servers write into, and the retention sweep that deletes files once their window has passed.

## Requirements

### Requirement: Managed roots

The system SHALL maintain a registry of managed roots — the only folders in which it creates, tags, or deletes transient output files. The `downloads` root (`data/downloads/`) SHALL always be registered; the `recordings` root SHALL be registered whenever `config.tester.recordingsDir` is configured — whether or not the tester is currently enabled, so disabling the tester doesn't leave existing recordings unswept. Every managed-file operation SHALL resolve paths through symlinks and refuse any path whose real location is outside a registered root. State, sessions, worktrees, backups, and repositories SHALL NOT be managed roots.

#### Scenario: Path inside a root

- **WHEN** an operation targets `data/downloads/<sessionId>/export.csv`
- **THEN** the operation proceeds

#### Scenario: Symlink escaping a root

- **WHEN** an operation targets a path inside a managed root that is a symlink to a file outside every registered root
- **THEN** the operation is refused and nothing is read, tagged, or deleted

#### Scenario: Tester disabled with recordings on disk

- **WHEN** the tester was used and is then disabled, with `config.tester.recordingsDir` still configured
- **THEN** `recordings` stays a managed root and existing recordings keep aging out under its windows

#### Scenario: No recordings folder configured

- **WHEN** `config.tester.recordingsDir` is not configured
- **THEN** there is no `recordings` root and nothing outside `downloads` is swept

### Requirement: Per-session downloads folder

Each query session SHALL have its own folder `data/downloads/<sessionId>/`, created when the session's MCP server configs are resolved. The same relative location SHALL apply locally and on the VM; the system SHALL NOT use the operator's home directory.

#### Scenario: Session folder created at session start

- **WHEN** a session starts and its MCP server configs are resolved
- **THEN** `data/downloads/<sessionId>/` exists

### Requirement: Session-aware MCP placeholder

`${CLACK_SESSION_DOWNLOADS_DIR}` in an `mcp.json` server's env or header values SHALL resolve to the absolute path of the current session's downloads folder, both at session start and when a server is attached mid-session. Other `${VAR}` references SHALL keep resolving from the process environment. Outside a session (boot-time checks), the placeholder SHALL resolve to `data/downloads/_system/`.

#### Scenario: Metabase exports into the session folder

- **WHEN** `mcp.json` sets metabase `EXPORT_DIRECTORY` to `${CLACK_SESSION_DOWNLOADS_DIR}` and a session attaches metabase
- **THEN** the metabase server process receives that session's downloads folder as `EXPORT_DIRECTORY`

#### Scenario: Two concurrent sessions

- **WHEN** two sessions attach the same server at the same time
- **THEN** each server process receives its own session's folder

#### Scenario: Boot-time listing

- **WHEN** the served-tools check lists a server whose config uses the placeholder
- **THEN** the placeholder resolves to `data/downloads/_system/` and the listing proceeds

### Requirement: Centralized file creation

Every internal tool that produces a transient output file — core tools and plugins alike — SHALL create it through the managed-files API: `createFile` (write bytes) or `reservePath` (obtain a path for an external process such as ffmpeg to write). Both SHALL place the file inside a managed root under the caller's owner folder, reduce the requested name to a basename, avoid overwriting an existing file (numeric suffix), and record a ledger entry with `createdAt` at creation. Plugins SHALL use `sdk.files.create` / `sdk.files.reservePath`, owned by `plugin:<pluginName>` in the `downloads` root.

#### Scenario: Core tool creates a file

- **WHEN** a core tool calls `createFile({ root: "downloads", owner: <sessionId>, name: "report.csv", data })`
- **THEN** the file is written to `data/downloads/<sessionId>/report.csv` and a ledger entry records its root, owner, and `createdAt`

#### Scenario: Name collision

- **WHEN** a file with the requested name already exists in the owner folder
- **THEN** the new file gets a numeric suffix and the existing file is untouched

#### Scenario: Name with path segments

- **WHEN** the requested name is `../../state/roles.json`
- **THEN** the file is created as `roles.json` inside the owner folder

#### Scenario: Core tool reserves a path

- **WHEN** a core tool calls `reservePath({ root: "recordings", owner: "tester", name: "demo.mp4" })`
- **THEN** it receives a not-yet-existing path inside the owner folder, following the same basename and collision rules, and a ledger entry with `createdAt` exists before any bytes are written there

#### Scenario: Write failure

- **WHEN** `createFile`'s disk write fails (disk full, permission denied, owner folder can't be created)
- **THEN** the call fails with the underlying error and no ledger entry is recorded for the file

#### Scenario: Plugin creates a file

- **WHEN** a plugin calls `sdk.files.create("chart.png", data)`
- **THEN** the file is written under `data/downloads/plugin:<pluginName>/` and tagged with owner `plugin:<pluginName>`

### Requirement: File ledger

The system SHALL keep a ledger at `data/state/file-ledger.json` with one entry per managed file: root, root-relative path, owner, `createdAt`, and — once delivered — `uploadedAt`, `fileId`, `permalink`, and the destination channel/thread. Each entry SHALL be validated on its own: a malformed entry SHALL be quarantined (set aside and surfaced to the owner) while the valid entries load. Writes SHALL be serialized.

#### Scenario: Upload recorded

- **WHEN** a managed file is uploaded to Slack
- **THEN** its entry gains `uploadedAt`, `fileId`, `permalink`, and the destination channel/thread

#### Scenario: Malformed ledger entry

- **WHEN** one entry in `file-ledger.json` fails validation at read time
- **THEN** that entry is quarantined and surfaced to the owner, the other entries load, and the entry's file (if still on disk) is re-tagged by discovery with `createdAt` = its mtime rather than deleted on the strength of the bad entry

### Requirement: Discovery of external writes

A file in a managed root with no ledger entry (written by an external process — an MCP server, the Playwright sidecar) SHALL be tagged when first seen by the sweep or by an upload-path lookup, with `createdAt` set to the file's modification time and owner set to its owner folder (`downloads`) or `tester` (`recordings`).

#### Scenario: Metabase export discovered

- **WHEN** the metabase server writes `data/downloads/<sessionId>/export.csv` and the sweep runs
- **THEN** the file gets a ledger entry with owner `<sessionId>` and `createdAt` equal to its mtime

#### Scenario: Sidecar recording discovered

- **WHEN** the Playwright sidecar writes a `.webm` into the recordings root and the sweep runs
- **THEN** the file gets a ledger entry with owner `tester` and `createdAt` equal to its mtime

### Requirement: Retention sweep

The system SHALL sweep every managed root once a day at local midnight and once at boot. A file that was uploaded SHALL be deleted once `keepUploaded` has passed since `uploadedAt`; a file never uploaded SHALL be deleted once `keepUnuploaded` has passed since `createdAt`. Files of an owner with a live run SHALL NOT be deleted in that sweep. Ledger entries whose file no longer exists SHALL be dropped, and empty owner folders removed. Each deletion SHALL be logged. Windows SHALL be configurable per root through an optional fail-fast config block, defaulting to downloads 7 days / 24 hours and recordings 14 days / 24 hours (uploaded / never uploaded).

#### Scenario: Uploaded export past its window

- **WHEN** an export was uploaded 8 days ago and the downloads root keeps uploaded files 7 days
- **THEN** the sweep deletes the file and drops its ledger entry

#### Scenario: Never-uploaded scratch file

- **WHEN** an export created 30 hours ago was never uploaded
- **THEN** the sweep deletes it

#### Scenario: Owner with a live run

- **WHEN** a file is past its window but its owning session has a live run
- **THEN** the sweep leaves it and revisits it on the next sweep

#### Scenario: Invalid retention config

- **WHEN** the retention config has a non-positive or non-numeric window
- **THEN** boot fails with a formatted config error

#### Scenario: Pending reservation never written

- **WHEN** a reserved path's file never appeared and the entry is past `keepUnuploaded`
- **THEN** the entry is dropped

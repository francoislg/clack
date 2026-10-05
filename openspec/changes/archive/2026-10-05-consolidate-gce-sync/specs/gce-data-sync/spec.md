## ADDED Requirements

### Requirement: Per-file classification against a per-clone baseline

`scripts/gce-pull.sh` and `scripts/gce-push.sh` SHALL compare local and VM files one file at a time by content hash, and SHALL classify every differing file using a per-clone baseline (`data/.gce-sync-baseline.json`, gitignored) that records the hash both sides last agreed on. Modification times SHALL NOT decide direction. A missing or unreadable baseline SHALL read as empty.

#### Scenario: File changed only locally

- **WHEN** a file's local hash differs from the VM hash
- **AND** the VM hash equals the baseline
- **THEN** it is classified as changed only locally

#### Scenario: File changed only on the VM

- **WHEN** a file's local hash differs from the VM hash
- **AND** the local hash equals the baseline and the VM hash does not
- **THEN** it is classified as changed only on the VM

#### Scenario: File changed on both sides or never synced

- **WHEN** a file's local hash differs from the VM hash
- **AND** neither hash equals the baseline (including when the baseline has no entry)
- **THEN** it is classified as changed on both sides

#### Scenario: Baseline records agreement

- **WHEN** a pull or push finishes
- **THEN** the baseline records the current hash for every file the run transferred or found identical
- **AND** entries for files the run skipped are left unchanged

### Requirement: Every run shows its plan first

Pull and push SHALL print the per-file plan (in sync count, and each file to create, replace, skip, or refuse, with its classification) before transferring anything. `--dry-run` SHALL print the plan and exit without writing or updating the baseline. `--show <file>` SHALL print a unified diff of one file (VM vs local) and exit.

#### Scenario: Dry run writes nothing

- **WHEN** `gce-push.sh --dry-run` or `gce-pull.sh --dry-run` runs
- **THEN** the plan is printed
- **AND** no file is written on either side and the baseline is unchanged

### Requirement: Pull replaces local with VM changes

`gce-pull.sh` SHALL create local files that exist only on the VM and SHALL replace every local file classified as changed only on the VM or on both sides. It SHALL NOT replace a file changed only locally. Before replacing a local file whose hash differs from the baseline, it SHALL copy the local file to `data/.gce-sync-backups/pull-<timestamp>/<path>`. Pull SHALL NOT delete local files.

#### Scenario: VM edit pulled

- **WHEN** an admin edited `data/config.json` from the Home Tab and the local copy is unchanged since the last sync
- **THEN** pull replaces the local copy without a backup

#### Scenario: Local edit preserved by backup

- **WHEN** a file changed on both sides
- **THEN** pull backs up the local copy, then replaces it with the VM copy

#### Scenario: Pending local change kept

- **WHEN** a file changed only locally
- **THEN** pull leaves it untouched and lists it as pending a push

### Requirement: Push never replaces a VM file unless named

`gce-push.sh` SHALL create files that are missing on the VM and SHALL skip identical files. It SHALL replace an existing VM file only when the file is named with `--overwrite <path>` (an exact file, or a directory covering the files under it) AND the file is classified as changed only locally. A named file changed on the VM or on both sides SHALL be refused with a pull-first message. An `--overwrite` path matching no file in scope SHALL fail the run before any transfer. Push SHALL NOT delete VM files and SHALL offer no flag that bypasses these rules.

#### Scenario: Plain push only creates

- **WHEN** `gce-push.sh` runs with no `--overwrite`
- **THEN** only files missing on the VM are written
- **AND** every differing file is listed and left untouched

#### Scenario: Named local change pushed

- **WHEN** `gce-push.sh --overwrite data/config.json` runs
- **AND** the VM copy of `data/config.json` is unchanged since the last sync
- **THEN** the VM copy is backed up to `/mnt/disks/clack-data/.gce-sync-backups/push-<timestamp>/data/config.json` and replaced

#### Scenario: VM changed since last sync

- **WHEN** `gce-push.sh --overwrite data/config.json` runs
- **AND** the VM copy changed since the last sync
- **THEN** the file is not pushed and the run tells the operator to pull, re-apply, and push again

#### Scenario: Typo in an overwrite path

- **WHEN** `--overwrite` names a path that matches no file in scope
- **THEN** the run fails before transferring anything

### Requirement: Scope and runtime-owned paths

Push and the default pull SHALL cover the paths listed in `data/.deploy-include`. `gce-pull.sh --all` SHALL cover the whole data tree except `data/repositories`, `data/worktrees`, the caches (`data/cache`, `data/.npm`, `data/.claude`, `data/mcp_packages`, `data/.pnpm-store`), `data/error-reports`, `data/.debug-sessions`, and the sync tool's own `data/.gce-sync-backups` and `data/.gce-sync-baseline.json`. Push SHALL reject, before any network call, a manifest entry at or under a runtime-owned path: `data/state`, `data/sessions`, `data/worktree-sessions`, `data/repositories`, `data/worktrees`, `data/backups`, `data/tester`, `data/downloads`, `data/error-reports`, `data/cache`, `data/.npm`, `data/.claude`, `data/mcp_packages`, `data/.pnpm-store`.

#### Scenario: State is never pushed

- **WHEN** `data/.deploy-include` lists `data/state`
- **THEN** `gce-push.sh` exits with an error naming the entry and transfers nothing

### Requirement: Pushed files are readable by the container

After a push that wrote files, `gce-push.sh` SHALL set ownership of the written files to the container user (uid 1001) and verify from inside the running container that each written file is readable, failing the run otherwise.

#### Scenario: Unreadable push detected

- **WHEN** a pushed file is not readable by the container user
- **THEN** the push exits non-zero and lists the file

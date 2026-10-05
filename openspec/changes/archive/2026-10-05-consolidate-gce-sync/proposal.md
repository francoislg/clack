## Why

Six scripts can write to the GCE VM's persistent data disk, and most of them overwrite by default: `gce-sync-to-vm.sh` and a re-run of `gce-deploy.sh` push the whole local `data/` tree (cron schedules in `data/state/` included — schedules have been clobbered this way), `gce-push-config.sh --force` replaces whole manifest directories, and the image deploy overwrites `worker-settings.json` and recreates sidecars on `:latest` with no diff. The drift check guesses direction from mtimes, which cannot see a file changed on both sides. The VM copy is authoritative for anything the bot or admins edit live, so a default overwrite loses real state.

## What Changes

- **BREAKING** — the GCE scripts collapse to three commands:
  - `scripts/gce-pull.sh` — VM → local. Pulls every file whose VM copy changed since the last sync, replacing the local copy by default and backing up any local file it replaces that had its own edits. A file that changed only locally is left alone.
  - `scripts/gce-push.sh` — local → VM, over the `data/.deploy-include` manifest. Creates files missing on the VM; never replaces an existing VM file unless it is named with `--overwrite <path>`, and even then only when the VM copy is unchanged since the last sync (compare-and-swap). Runtime-owned paths (`data/state/**`, `data/sessions/**`, …) can never be pushed. Replaced VM files are backed up outside `data/`.
  - `scripts/gce-deploy.sh` — image build + container swap, built from a clean `git archive` of HEAD, stamped with the commit SHA; refuses to deploy a commit that is not a descendant of the one running in prod. Writes no data files. Before the swap it waits, with the bot still running, until no run is in flight (capped by `IDLE_MAX_WAIT`, skipped with `--no-idle-wait`). Sidecars are created only when missing or when their config changed, never re-pulled implicitly. `--provision` creates the infrastructure (VPC, firewall, disk, VM, mount) and seeds the data disk only when it is empty.
- Both sync commands share one per-file engine (`scripts/gceSync/`) that classifies each file against a per-clone baseline of last-synced hashes, prints the plan before acting, and supports `--dry-run` and `--show <file>`.
- Removed: `gce-config-diff.sh`, `gce-push-config.sh`, `gce-sync-to-vm.sh`, `gce-sync-from-vm.sh`, `gce-update-image.sh` (its body becomes `gce-deploy.sh`).
- `data/worker-settings.json` moves from the image deploy into the push manifest.
- The `deploy` and `migrate-skill-pack` skills stop using `--force` and use the new commands.

## Capabilities

### New Capabilities

- `gce-data-sync`: per-file, baseline-aware pull and push between local `data/` and the VM's data disk.

### Modified Capabilities

- `docker-deployment`: the GCE deployment script requirement changes (image-only deploy from HEAD, SHA stamp + ancestry check, provisioning seeds only an empty disk, sidecars not recreated without cause); scenarios naming `gce-update-image.sh` now name `gce-deploy.sh`.
- `tester-services`: the sidecar deploy requirement names `gce-deploy.sh` and no longer recreates a running proxy without cause.

## Impact

- Scripts: `scripts/gce-*.sh`, new `scripts/gceSync/` (TypeScript, run with `tsx`), `scripts/lib/gce-provision.sh`. `tsconfig.scripts.json` type-checks `scripts/`, and CI runs it.
- `Dockerfile` gains a `BUILD_SHA` build-arg surfaced as an image label.
- Skills: `.claude/skills/deploy`, `.claude/skills/migrate-skill-pack`.
- Docs: `CLAUDE.md`, `docs/worker-settings.md`, `docs/tester-services.md`, `docs/status-server.md`, `data/.deploy-include.example`, `data/docker/Dockerfile.custom.example`, `Dockerfile.tools`, `docker-compose.tester.yml`, `src/plugins/geolocation/README.md`, `package.json` (`deploy:gce`).
- Operators: the first pull/push after upgrade has no baseline, so every differing file is treated as changed on both sides (pull replaces local with a backup; push refuses `--overwrite` until a pull records the baseline). The first deploy after upgrade faces an unstamped prod image and needs `--allow-unstamped`.

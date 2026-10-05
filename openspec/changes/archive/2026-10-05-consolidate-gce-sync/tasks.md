## 1. Sync engine (`scripts/gceSync/`)

- [x] 1.1 `manifest.ts`: parse `data/.deploy-include`; reject runtime-owned paths; tests
- [x] 1.2 `baseline.ts`: zod-parse `data/.gce-sync-baseline.json` (unreadable → empty); record entries; tests
- [x] 1.3 `plan.ts`: pure pull/push classification + `--overwrite` resolution per design table; tests for every row, directory overwrite, and unmatched-path error
- [x] 1.4 `inventory.ts`: local sha256 inventory (skips `._*`, `.DS_Store`, excluded top-level dirs) + integration test on a temp dir; remote inventory command builder + output parser with tests
- [x] 1.5 `vm.ts`: gcloud ssh runner, tar transfers, VM-side backup, chown, container read check
- [x] 1.6 `cli.ts`: `pull`/`push` commands, `--dry-run`, `--show`, `--overwrite`, `--path`, `--all`; plan printing; baseline update after success; local pull backups

## 2. Entry scripts

- [x] 2.1 `scripts/gce-pull.sh` and `scripts/gce-push.sh` wrappers
- [x] 2.2 `scripts/gce-deploy.sh` from `gce-update-image.sh`: `git archive HEAD` build context, `BUILD_SHA` build-arg, prod SHA ancestry gate (`--redeploy`, `--allow-rollback`, `--allow-unstamped`), no worker-settings push, sidecars only with cause (`--refresh-sidecars`)
- [x] 2.3 `Dockerfile`: `ARG BUILD_SHA` + `LABEL clack.build-sha`
- [x] 2.4 `scripts/lib/gce-provision.sh` + `gce-deploy.sh --provision`; seed only an empty data dir
- [x] 2.5 Remove `gce-config-diff.sh`, `gce-push-config.sh`, `gce-sync-to-vm.sh`, `gce-sync-from-vm.sh`, `gce-update-image.sh`; update `gce-common.sh` messages
- [x] 2.6 Gitignore the baseline and pull-backup paths; add `data/worker-settings.json` to `data/.deploy-include.example` (and the local manifest)

## 3. Skills and docs

- [x] 3.1 `.claude/skills/deploy/SKILL.md`: Step 0 = `gce-push.sh --dry-run`, run `gce-deploy.sh`, no `--force`
- [x] 3.2 `.claude/skills/migrate-skill-pack/SKILL.md`: push via `gce-push.sh` (+ `--overwrite` only for named files)
- [x] 3.3 `CLAUDE.md`, `docs/worker-settings.md`, `docs/tester-services.md`, `docs/status-server.md`, `Dockerfile.tools`, `docker-compose.tester.yml`, `data/docker/Dockerfile.custom.example`, `src/plugins/geolocation/README.md`, `package.json`

## 4. Verification

- [x] 4.1 `npx tsc` over `scripts/gceSync`, oxlint, oxfmt, full test suite
- [x] 4.2 `bash -n` on every changed shell script
- [x] 4.3 Live read-only check: `gce-push.sh --dry-run` and `gce-pull.sh --dry-run` against the VM
- [x] 4.4 `openspec validate consolidate-gce-sync --strict`

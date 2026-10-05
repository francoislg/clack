## Context

The VM's persistent disk (`/mnt/disks/clack-data/data`, mounted at `/app/data`) is written by the bot itself (state, sessions, Home Tab config edits) and by operators pushing config from a local clone. Today's scripts decide direction by mtime or not at all, and the unit of transfer is a whole directory or the whole tree.

## Goals / Non-Goals

**Goals:** no VM file is replaced without an explicit, per-file operator request; a file changed on both sides is always detected; every run shows its plan first; three entry points total.

**Non-Goals:** merging file contents, deleting files on either side, multi-operator coordination beyond per-clone baselines.

## Decisions

### Per-clone baseline

`data/.gce-sync-baseline.json` (gitignored) maps each synced path to the sha256 both sides last agreed on. It is written after every pull/push for the files the run touched or found identical. It lives in the clone, not on the VM: a VM-side baseline would tell a stale clone that its old copy is "changed locally" and let it push old content. A missing or unreadable baseline reads as empty, which classifies every differing file as changed on both sides — the safe direction.

### Classification

For each path under the scope, with `L`/`V` the local/VM hashes and `B` the baseline:

| Case | Pull | Push |
|---|---|---|
| only on VM | create local | report (never deleted) |
| only local | report | create on VM |
| `L = V` | in sync (record `B`) | in sync (record `B`) |
| `L ≠ V`, `V = B` (only local changed) | skip — pending push | listed; replaced only with `--overwrite` |
| `L ≠ V`, `V ≠ B`, `L = B` (only VM changed) | replace local | refused — pull first |
| `L ≠ V`, neither equals `B` (both changed / no baseline) | replace local, back up local first | refused — pull first |

Push `--overwrite <path>` accepts an exact file or a directory (every file under it); it applies only to files in the "only local changed" row. Naming a file in any other row is reported and not pushed; naming a path that matches nothing is an error, so a typo cannot silently no-op.

The planner is pure (`scripts/gceSync/plan.ts`); I/O lives in thin modules around it.

### Scope

Push and default pull cover the manifest (`data/.deploy-include`). `pull --all` covers the whole data tree except caches, `repositories/`, `worktrees/`, `error-reports/`, `.debug-sessions/`, and the sync tool's own backups and baseline. Push rejects a manifest entry under a runtime-owned path (`state`, `sessions`, `worktree-sessions`, `repositories`, `worktrees`, `backups`, `tester`, `downloads`, `error-reports`, caches) before any network call.

### Backups

Pull backs up each replaced local file that had its own edits to `data/.gce-sync-backups/pull-<ts>/`. Push copies each VM file it replaces to `/mnt/disks/clack-data/.gce-sync-backups/push-<ts>/` — outside `data/`, so backups never land in a served config tree.

### Deploy from a commit

`gce-deploy.sh` builds from `git archive HEAD` extracted to a temp dir, so uncommitted work never ships, and passes `--build-arg BUILD_SHA=<sha>`, which the Dockerfile records as label `clack.build-sha`. Before building, it reads the running container's label: equal to HEAD → refuse (`--redeploy` to force a rebuild); not an ancestor of HEAD → refuse (`--allow-rollback`); absent → refuse (`--allow-unstamped`, needed once after this change).

### Sidecars

`clack-playwright` and `clack-docker-proxy` are created when missing, recreated when the Playwright config hash changed, and otherwise left running. An image is pulled only when absent on the VM; upgrading a sidecar is an explicit `--refresh-sidecars`.

### Provisioning

`--provision` runs the infrastructure steps from the old bootstrap script and then seeds the data disk from local `data/` only if the remote data directory is empty; otherwise it skips the seed and says so. Seeding onto a used disk is never possible.

## Risks / Trade-offs

- First run after upgrade has no baseline → one bootstrap pull per clone. Mitigated by backups; documented in the proposal.
- `git archive` omits gitignored build inputs; the app image needs none (the `.dockerignore` allowlist only names tracked files), and the tools overlay still reads `data/docker/` from the working clone.

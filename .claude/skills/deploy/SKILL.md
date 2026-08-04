---
name: deploy
description: >
  Roll out the latest local code to the Clack GCE VM. Runs scripts/gce-update-image.sh
  in the background, surfaces each phase (build → push → prune → pull → drain → swap →
  ready) via a Monitor, reports the downtime, and finally checks whether local
  tool mappings have diverged from the VM — if so, prompts to push them too.
  Trigger when the user says "deploy", "deploy again", "deploy now", "ship it",
  "redeploy", or any near variant.
---

# Deploy to GCE

Orchestrates the standard image-update deploy for the Clack VM. Replaces the
manual sequence of "kick off bash, arm monitor, ack each phase, extract downtime."

## Step 1 — kick off the deploy in the background

```
Bash(
  command: "bash scripts/gce-update-image.sh",
  description: "Deploy",
  run_in_background: true
)
```

Note the returned `task_id` (e.g. `bey7dhw8e`) AND the output file path
(`/private/tmp/.../tasks/<task_id>.output`). You need both.

## Step 2 — arm a Monitor with the standard phase filter

```
Monitor(
  description: "deploy progress",
  timeout_ms: 900000,    # 15 min — safely above the script's 5-min readiness wait
  persistent: false,
  command: "tail -f <OUTPUT_FILE> | grep -E --line-buffered \"✓|✗|ERROR|error:|failed|denied|no space|Artifact Registry|Pre-pulling|Draining old container|Stopping old|Waiting for|Bot is ready|downtime|Step [0-9]+/[0-9]+ : FROM|Successfully built|Successfully tagged|^DONE|New image pulled|Total reclaimed|worker-settings|Worker settings|overlay detected\""
)
```

That filter catches every phase marker plus the failure modes the script
itself surfaces.

## Step 3 — acknowledge each phase event tersely

The user is watching the live stream; don't restate what they already see.
One sentence per event, matching the marker:

| Event substring | Reply |
|---|---|
| `Creating Artifact Registry repo` | `Creating registry repo (first AR deploy).` |
| `Custom overlay detected` | `Overlay build (base + custom layers).` |
| `Base image pushed` | `Base pushed; building overlay.` |
| `Overlay image pushed` | `Overlay pushed.` |
| `Step 1/32 : FROM ... Step 8/32 : FROM` | `Build phase.` |
| `Successfully built <sha>` | `Built.` |
| `^DONE` (after build) | `Pushed.` |
| `Pre-pulling new image (bot still running)` | `Pre-pulling.` |
| `Total reclaimed space: <X> GB` | `<X> GB reclaimed.` |
| `New image pulled` | `Pulled.` |
| `Worker settings pushed` | `Worker settings synced.` |
| `No local data/worker-settings.json` | `No local worker settings; VM copy untouched.` |
| `Draining old container in-process` | `Draining — app finishing in-flight runs before exit.` |
| `Stopping old container and starting new one` | `Downtime clock running.` |
| `Waiting for bot to reach 'Clack is ready'` | `Polling.` |

## Step 4 — when the bash task completes, extract the downtime

The bash task fires its own completion notification. On that notification:

```
Bash(command: "grep -E 'downtime|Bot is ready' <OUTPUT_FILE> | tail -1")
```

Report it as `**Downtime: 28s.**` (the actual seconds).

## Step 5 — check tool mappings divergence

After downtime is reported, compare every local
`data/default_configuration/tool_mapping/*.json` against the VM:

```bash
DIVERGED=()
for f in data/default_configuration/tool_mapping/*.json; do
    name=$(basename "$f")
    local_md5=$(md5 -q "$f")
    remote_md5=$(gcloud compute ssh clack --zone=northamerica-northeast1-a --quiet \
        --command="sudo md5sum /mnt/disks/clack-data/data/default_configuration/tool_mapping/$name | cut -d' ' -f1" 2>/dev/null)
    [ "$local_md5" != "$remote_md5" ] && DIVERGED+=("$name")
done
[ ${#DIVERGED[@]} -gt 0 ] && printf 'DIVERGED: %s\n' "${DIVERGED[@]}" || echo "IN SYNC"
```

- **If `IN SYNC`** → say nothing further beyond the downtime line.
- **If any files diverged** → say:

  > Local tool mappings differ from the VM: `<file1>`, `<file2>`, ...
  > Push them with `bash scripts/gce-push-config.sh`?

  Wait for the user's confirmation. If they say yes, run:

  ```
  Bash(command: "bash scripts/gce-push-config.sh --force 2>&1 | grep -vE 'LIBARCHIVE\\.xattr|known_hosts' | grep -E '✓|Streaming|✗'")
  ```

  Deploy context implies overwrite intent, so `--force` is appropriate
  here (the safety check is for accidental clobbers, not authorized ones).

## Step 6 — handle the stale monitor event

After the bash task completes, the Monitor often emits one final notification
a few minutes later: `[Monitor timed out — re-arm if needed.]`. That's
expected. Acknowledge with `Stale monitor. Idle.` and stop.

## Failure modes (from gce-update-image.sh)

The script exits non-zero on:
- **Container crash during swap** → script prints `docker logs --tail 80 clack` command
- **5-min timeout waiting for "Clack is ready"** → script prints `docker logs -f clack` command
- **`no space left on device`** → boot disk full; the script's `docker image prune -f`
  before pull is meant to prevent this. If it recurs, check
  `/mnt/stateful_partition` usage on the VM.
- **`denied: Unauthenticated request`** on pull → the configure-docker step
  failed; usually a one-off and resolved by re-running.
- **`denied: Permission "artifactregistry.repositories.downloadArtifacts" denied`**
  (or similar `artifactregistry...denied`) on pull → the VM's service account is
  missing `roles/artifactregistry.reader`. Artifact Registry is strictly IAM-gated,
  so re-running will NOT fix this. `gce-deploy.sh` grants the role on first-time
  instance creation; a VM provisioned before the GCR→AR migration needs a manual
  grant (the exact command is in the comment around the IAM step in
  `scripts/gce-deploy.sh`). Forward that command to the user.

In every case the script's stderr includes a copy-pasteable diagnostic
command. Forward it to the user verbatim.

## Drain phase (before swap)

The app drains itself: `docker stop -t <DRAIN_MAX_WAIT>` sends SIGTERM, and the
process quiesces (refuses new runs), waits for in-flight runs (query + worker/tester)
to finish, then exits — all before Docker's stop timeout elapses.

- A **long stop is expected, not a hang** — the app is finishing in-flight work. The
  wait is bounded by `DRAIN_MAX_WAIT` (default 300s); the app stops any stragglers and
  exits, and Docker SIGKILLs at the timeout as a backstop.
- An older running image (predating in-process drain) simply exits immediately on
  SIGTERM — the `docker stop -t` still works, just without the drain wait.

## Gotchas

- **macOS `._*` xattr files** show up in tar-pipe diffs but are not real
  content differences. The `gce-push-config.sh` safety check still flags
  them — that's a known false positive. Use `--force` to bypass.
- **The skill is `image-only`** — it does NOT push `config.json`,
  `mcp.json`, or `default_configuration/`. Those live on the persistent
  disk and need `gce-push-config.sh`. The tool-mapping check at Step 5
  catches the most common case where this matters.
- **Don't poll** for completion. The Bash background task and the Monitor
  both notify automatically.

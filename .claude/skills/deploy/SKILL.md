---
name: deploy
description: >
  Roll out the latest local code to the Clack GCE VM. Runs scripts/gce-deploy.sh (an image-only deploy of the committed HEAD)
  in the background, surfaces each phase (build → push → prune → pull → idle wait → drain → swap →
  ready) via a Monitor, and reports the downtime. ALWAYS starts with a mandatory
  read-only sync check (scripts/gce-push.sh --dry-run) — every difference is flagged to the user before
  anything is deployed.
  Trigger when the user says "deploy", "deploy again", "deploy now", "ship it",
  "redeploy", or any near variant.
---

# Deploy to GCE

Orchestrates the standard image-update deploy for the Clack VM. Replaces the
manual sequence of "kick off bash, arm monitor, ack each phase, extract downtime."

## Step 0 — MANDATORY sync check (before anything else)

The VM's copies of `config.json` / `configuration/**` are authoritative (the
Home Tab and MCP admin tools write them live). Before deploying, run the
read-only plan and flag every difference:

```
Bash(command: "bash scripts/gce-push.sh --dry-run", timeout: 300000)
```

- **Only "in sync"** → say so in one line and proceed to Step 1.
- **Anything else** → report every listed file to the user BEFORE continuing:
  "Create on VM", "Not pushed — differs" (with its reason), and "VM only". A
  file whose reason says the VM changed means the local tree is stale: suggest
  `bash scripts/gce-pull.sh`, never a push.
- Never skip this step, even for a "quick redeploy".

The deploy itself writes no data files — `scripts/gce-push.sh` and
`scripts/gce-pull.sh` are the only paths that move files between this clone and
the VM, and `data/state/**` (cron jobs, roles, prefs) is never pushed.

## Step 1 — kick off the deploy in the background

```
Bash(
  command: "bash scripts/gce-deploy.sh",
  description: "Deploy",
  run_in_background: true
)
```

Note the returned `task_id` (e.g. `bey7dhw8e`) AND the output file path
(`/private/tmp/.../tasks/<task_id>.output`). You need both.
The deploy builds the committed HEAD (uncommitted changes never ship) and refuses when prod already runs HEAD (--redeploy), when prod runs a commit HEAD doesn't contain (--allow-rollback), or when prod's image carries no build SHA (--allow-unstamped). Never add one of these flags without the user's explicit go-ahead for that deploy — report the refusal and ask.

## Step 2 — arm a Monitor with the standard phase filter

```
Monitor(
  description: "deploy progress",
  timeout_ms: 2400000,    # 40 min — above the 15-min idle-wait cap + 5-min drain + 5-min readiness wait
  persistent: false,
  command: "tail -f <OUTPUT_FILE> | grep -E --line-buffered \"✓|✗|ERROR|error:|failed|denied|no space|Artifact Registry|Pre-pulling|go idle|Clack is idle|[Ii]dle wait|falling through|Draining old container|Stopping old|Waiting for|Bot is ready|downtime|Step [0-9]+/[0-9]+ : FROM|Successfully built|Successfully tagged|^DONE|New image pulled|Total reclaimed|overlay detected|Deploying commit|Refusing|Could not reach|sidecar|Docker proxy\""
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
| `Waiting for Clack to go idle` | `Waiting for in-flight runs to finish (bot still up).` |
| `Waiting for idle —` | One line: what's still running and the elapsed time. |
| `Clack is idle` | `Idle.` |
| `falling through to the drain` | Forward the line (cap hit or status unreachable). |
| `Skipping idle wait` | `Idle wait skipped.` |
| `Deploying commit` | `Building <short sha>.` |
| `Refusing` | Forward the refusal verbatim and stop. |
| `sidecar unchanged` | `Sidecar left running.` |
| `sidecar (re)created` | `Sidecar recreated.` |
| `Docker proxy unchanged` | `Proxy left running.` |
| `Docker proxy (re)created` | `Proxy recreated.` |
| `Could not reach the VM` | Forward the line verbatim and stop. |
| `Draining old container in-process` | `Draining — app finishing in-flight runs before exit.` |
| `Stopping old container and starting new one` | `Downtime clock running.` |
| `Waiting for bot to reach 'Clack is ready'` | `Polling.` |

## Step 4 — when the bash task completes, extract the downtime

The bash task fires its own completion notification. On that notification:

```
Bash(command: "grep -E 'downtime|Bot is ready' <OUTPUT_FILE> | tail -1")
```

Report it as `**Downtime: 28s.**` (the actual seconds).

## Step 5 — files flagged in Step 0

The deploy never moves data files. If Step 0 listed files the user wants on
the VM:

- **"Create on VM"** entries → `bash scripts/gce-push.sh` (creates only; never
  replaces).
- **"Not pushed — differs (only local changed)"** → push ONLY the files the
  user explicitly names, one `--overwrite` per file:
  `bash scripts/gce-push.sh --overwrite data/config.json`. The script refuses
  the file if its VM copy changed since the last sync.
- Anything whose reason says the VM changed → `bash scripts/gce-pull.sh` first,
  re-apply the local change, then push it by name.

Never pass `--overwrite` for a file the user didn't name.

## Step 6 — handle the stale monitor event

After the bash task completes, the Monitor often emits one final notification
a few minutes later: `[Monitor timed out — re-arm if needed.]`. That's
expected. Acknowledge with `Stale monitor. Idle.` and stop.

## Failure modes (from gce-deploy.sh)

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
  so re-running will NOT fix this. `gce-deploy.sh --provision` grants the role on first-time
  instance creation; a VM provisioned before the GCR→AR migration needs a manual
  grant (the exact command is in the comment around the IAM step in
  `scripts/lib/gce-provision.sh`). Forward that command to the user.

In every case the script's stderr includes a copy-pasteable diagnostic
command. Forward it to the user verbatim.

## Idle wait and drain (before swap)

**Idle wait.** After the pre-pull, the script waits — with the bot still running and
accepting everything, nothing quiesced — until `/status` reports `busy: false` (no query
run and no executing Changes-Workflow run, the same definition the drain uses). The poll
runs inside the container every 5s and prints what is still running (channel/thread or
repo@branch, status, age) whenever that changes and at least every 30s.

- A **long idle wait is expected, not a hang** — a user's run is finishing normally. It is
  capped by `IDLE_MAX_WAIT` (default 900s = 15 min); at the cap, or if the status endpoint
  can't be reached, the script falls through to the drain.
- `--no-idle-wait` skips it and swaps right away. Pass it only on the user's explicit ask.
- A new run can start between "idle" and the swap; the drain below covers it.

**Drain.** `docker stop -t <DRAIN_MAX_WAIT>` sends SIGTERM, and the process quiesces
(refuses new runs), waits for in-flight runs (query + worker/tester) to finish, then
exits — all before Docker's stop timeout elapses. After the idle wait this is normally
near-instant.

- The drain wait is bounded by `DRAIN_MAX_WAIT` (default 300s); the app stops any
  stragglers and exits, and Docker SIGKILLs at the timeout as a backstop.
- An older running image (predating in-process drain) simply exits immediately on
  SIGTERM — the `docker stop -t` still works, just without the drain wait.

## Gotchas

- **Instance settings live in `data/gce.env`** (gitignored; `data/gce.env.example`
  lists the keys). A "No zone set" error means that file is missing or lacks
  `GCE_ZONE` — ask the user for the values; never guess a zone or project.

- **The skill is image-only** — it never pushes `config.json`, `mcp.json`,
  `worker-settings.json`, or `default_configuration/`. Those move only through
  `scripts/gce-push.sh` (see Step 5).
- **Don't poll** for completion. The Bash background task and the Monitor
  both notify automatically.

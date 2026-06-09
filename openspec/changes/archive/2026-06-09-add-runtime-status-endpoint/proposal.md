## Why

There is no way to observe, from outside the process, whether Clack is currently doing work — neither in-flight Q&A runs nor busy Changes-Workflow workers. The bot runs in Slack Socket Mode and exposes no HTTP surface. As a direct consequence, `deploy` swaps the container with a hard `docker stop`, which can kill an in-flight Claude run mid-answer. We want a pingable status endpoint AND a deploy that drains active work before the swap.

## What Changes

- Add a small **HTTP status server** (separate from Socket Mode, bound to `127.0.0.1`) started at boot. `GET /status` returns, computed live at request time: process `version`/`uptimeSec`, an `activeRuns` snapshot (count + per-run `{channel, thread, status, ageMs}`), `workers` busy/idle counts, and a convenience `busy` boolean (`activeRuns.count > 0 || workers.busy > 0`).
- Extend the **active-runs registry** to stamp each entry with a start time and expose a `snapshot()` accessor (today it exposes only `size()`), so the endpoint can report per-run identity and age. A wedged run becomes *visible* via `ageMs`; no auto-eviction is added.
- Add a **drain gate** to `scripts/gce-update-image.sh`: a new phase before the container swap that polls `/status` and waits for `busy: false`, up to a bounded `maxWait`, then proceeds anyway (printing any still-active runs). Publish the status port to `127.0.0.1` on the VM (`-p`) so the script can reach it.
- Update the **`/deploy` skill** (`.claude/skills/deploy/SKILL.md`) so the Monitor filter and phase-acknowledgement table surface the new drain phase.

Non-goals: no max-age reaper (bounded-wait-then-proceed covers wedged runs); no "quiet mode" that refuses new triggers during drain; no auth on the endpoint (localhost-only).

## Capabilities

### New Capabilities
- `runtime-status-endpoint`: An HTTP server, separate from Slack Socket Mode, that exposes a live `GET /status` snapshot of active query runs and busy workers for monitoring and deploy gating.

### Modified Capabilities
- `active-runs-registry`: Each registry entry gains a start timestamp; a new `snapshot()` accessor returns per-run identity, status, and age. (Existing `size()` and routing behavior unchanged.)
- `docker-deployment`: The GCE image-update deploy gains a pre-swap drain phase that waits for the bot to be idle (bounded), and publishes the status port to localhost so the script can poll it.

## Impact

- **New code**: an HTTP status-server module wired into the boot sequence (`src/index.ts`).
- **Modified code**: `src/slack/activeRuns.ts` (start time + `snapshot()`); the worker pool's existing `list()` is read as-is.
- **Modified ops**: `scripts/gce-update-image.sh` (drain phase + `-p 127.0.0.1:PORT:PORT`), `.claude/skills/deploy/SKILL.md` (Monitor filter + phase table).
- **No change** to Socket Mode, Slack behavior, or worker-pool internals.

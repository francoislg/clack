## Context

Clack runs in Slack Socket Mode and binds no HTTP port. Two independent sources track "active work":

1. **Query runs** — `src/slack/activeRuns.ts`, an in-memory `Map<channel:thread, ClaudeRunHandle>`. Exposes only `size()`. Slots are freed by the handle's `onTerminal` hook on settle/stop/fail.
2. **Worker runs** — Changes Workflow runs do NOT register in `activeRuns`; they hold a `ClaudeRunHandle` in the `activeChanges` map (`src/changes/activeState.ts`) while executing, and (in reusable mode only) occupy a pool worker whose `status` becomes `"busy"`. Two existing accessors are relevant: `getWorkerPoolSnapshot()` reports per-worker busy/idle counts **but only for `ReusablePool`** — it returns empty in the default disposable mode; and `getActiveWorkers()` lists active changes **but its entries persist for the whole change lifecycle** (e.g. `pr_created` awaiting follow-ups), so its mere presence does not mean Claude is executing.

`scripts/gce-update-image.sh` swaps the container with a hard `docker stop`, which can interrupt either kind of in-flight run. The deploy SSHes into the VM and runs `docker run` with `-v .../data:/app/data`, no published ports.

Leak analysis (from exploration): worker runs are bounded by `executeChange`'s `timeoutMs` (default 10 min) plus the pool idle-release sweep, so they self-terminate. The only unbounded case is a wedged **query** run (`askClaude` has no timeout) where the SDK subprocess hangs and `onTerminal` never fires — pinning a registry slot indefinitely.

## Goals / Non-Goals

**Goals:**
- A pingable `GET /status` endpoint reporting live active-run and busy-worker state.
- A deploy that waits for the bot to go idle before the container swap, so a hard stop doesn't kill an in-flight answer.
- Make a wedged run *visible* (per-run age) so a human can judge staleness.

**Non-Goals:**
- No max-age reaper / auto-eviction of registry entries (bounded-wait-then-proceed covers the wedged case).
- No "quiet mode" that refuses or queues new Slack triggers during drain.
- No authentication on the endpoint (localhost-only binding is the boundary).
- No change to worker-pool internals or Socket Mode.

## Decisions

### D1 — Standalone HTTP server, not the Bolt receiver
Socket Mode's Bolt app opens no HTTP listener, and adding a public receiver would change the Slack connection model. Use a separate `http.createServer` in its own module, started from the boot sequence (`src/index.ts`) and bound to `127.0.0.1`. Port is read from config/env with a default (e.g. `STATUS_PORT`, default `8787`).
**Alternative considered:** a status *file* on the mounted data disk, read by the deploy over SSH. Rejected as the primary surface — the user wants a pingable endpoint, and the HTTP server computes state live with zero background cost. (The file would only have been written on transition anyway; not a polling bottleneck, but redundant once we have the endpoint.)

### D2 — Pull-based, computed at request time
`/status` reads its sources synchronously when the request arrives. No background timers, no cached state to go stale.

### D2a — Cross-mode worker signal: active changes with a running handle
The drain-relevant "a worker is working" signal is **a Changes-Workflow run whose `ClaudeRunHandle` is currently `running`**, which holds in both disposable and reusable modes. The endpoint derives this from the `activeChanges` map via a new accessor that counts/snapshots changes where `handle?.status === "running"` — NOT from `getWorkerPoolSnapshot()` (reusable-only) and NOT from raw `getActiveWorkers()` presence (which lingers post-execution). The reusable pool's busy/idle breakdown is still surfaced as supplementary detail when available, but `busy` is driven by the running-handle count so it is correct in disposable mode. So `busy = activeRuns.count > 0 || workers.active > 0`.

### D3 — Registry gains a start time + `snapshot()`, not a reaper
`register()` stamps `startedAt` on the entry. A new `snapshot()` returns `{ count, runs: [{ channel, thread, status, ageMs }] }`. `status` comes from the handle (`running`/`settled`/`stopped`). `ageMs` is derived at snapshot time. We deliberately do NOT evict old entries — the drain gate's timeout is what bounds a wedged run's impact, and eviction would risk freeing a slot whose run is actually alive.
**Note on `Date.now()`:** the registry is production code (not a workflow script), so `Date.now()` is fine for `startedAt`/`ageMs`. Tests use `vi.useFakeTimers()`.

### D4 — Drain gate: bounded wait, then proceed
New phase in `gce-update-image.sh` *before* the swap. Poll `GET /status` every ~5s:
- `busy:false` → proceed immediately.
- busy within `maxWait` → keep waiting, print `(N runs, M workers) waiting…`.
- `maxWait` exceeded → print the still-active runs (with ages) and proceed with the swap anyway.

`maxWait` default ~5 min, matching the existing readiness wait. Reaching it past a genuinely-busy or wedged bot still deploys — acceptable for a low-traffic internal bot; the printed run list tells the operator what got interrupted.

### D5 — Reachability: docker-exec probe for the gate; published loopback port for humans
The container publishes `-p 127.0.0.1:${STATUS_PORT}:${STATUS_PORT}` so an operator on the VM can ping the endpoint (via tunnel or host curl). The **drain gate does NOT depend on the host having `curl`/`jq`** (the GCE Container-Optimized OS host may lack them): it probes via `docker exec clack node -e 'fetch("http://127.0.0.1:<port>/status")…'`, which runs inside the container's own network namespace where the server binds, and parses the small JSON in-process. Node is guaranteed present (it's the image runtime). The probe still performs a `GET /status`; it just uses the most dependency-free transport. An unreachable endpoint (older image without `/status`, or container down) makes the probe exit non-zero → the gate logs "skipped" and proceeds.

### D6 — Skill mirrors the new phase
`.claude/skills/deploy/SKILL.md` adds the drain markers to the Monitor `grep` filter and a row to the Step 3 phase-acknowledgement table (e.g. `Draining` → `Draining active runs.`), and notes the gate in the description/failure-modes so the operator understands a long drain wait.

## Risks / Trade-offs

- **Busy workspace never goes idle** → bounded `maxWait` guarantees the deploy still proceeds; the operator sees what was active.
- **Wedged query run pins a slot** → not blocking (D4 proceeds past `maxWait`); `ageMs` surfaces it. A reaper remains a possible future change if this proves common.
- **Endpoint unauthenticated** → mitigated by `127.0.0.1` binding; not exposed off-host. If remote monitoring is later wanted, front it with an SSH tunnel rather than opening the port.
- **New runs start during drain** → accepted (no quiet mode); the gate targets a natural lull, not a hard quiesce.
- **Port already in use on boot** → server start failure must be logged and non-fatal to the bot (status is auxiliary; the bot must still run).

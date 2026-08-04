## Why

When Clack is deployed, the container is swapped with `docker stop` (SIGTERM → 10s → SIGKILL). The in-process signal handler tears everything down immediately (`stopAll` + `stopSlackApp` + `exit(0)`), so any in-flight Claude run — a query answer being generated, a change being implemented, a tester driving a browser — is killed mid-thought. The deploy today compensates with an *external* drain (`gce-update-image.sh` polls `GET /status` for a lull before the swap), but an external observer cannot stop the Slack socket from starting *new* runs while it waits, so the drain never reliably converges and long worker runs are still cut off.

Move the drain inside the process: on SIGTERM, quiesce (refuse new runs), let every in-flight run finish, then exit. The operator's contract becomes a single `docker stop -t <budget>` that blocks until Clack has finished its work and exited cleanly.

## What Changes

- **In-process graceful shutdown.** On SIGTERM the process enters a drain sequence: set a quiescing flag, wait for every registered run (query + worker + tester) to reach a terminal state, then `stopAll` / `stopSlackApp` / `exit(0)`. A second SIGTERM/SIGINT forces immediate exit.
- **Quiesce gate.** While quiescing, the three run-creation choke points — `processMessage` (all query triggers), `executeChange` (all worker/tester runs), and the cron `executeJob` dispatch — refuse to start new runs. Rejected interactive triggers (DM/@mention) get an ephemeral "restarting, back shortly" notice; rejected cron fires are skipped and recovered by the existing cron catch-up on reboot.
- **Bounded drain.** "Wait for everything" is bounded by a grace budget (default 300s). When the budget elapses, remaining runs are `stop()`-ed (worker/tester runs persist and resume via the existing restart/monitor path) and the process exits anyway, logging what it cancelled.
- **Observable drain state.** `GET /status` gains a lifecycle `state` field (`"running"` | `"draining"`) so the deploy and the operator can see Clack is finishing N runs before shutdown.
- **Simplified deploy.** The deploy's external drain poll (Phase 1.5) is replaced by `docker stop -t <budget>`, which delegates draining to the process. The `/deploy` skill's drain-phase surfacing updates to read the process-side drain markers.

## Capabilities

### New Capabilities
- `graceful-shutdown`: Signal-driven quiesce-and-drain — on SIGTERM the process stops accepting new runs, waits for in-flight runs to finish within a bounded budget, stops stragglers, and exits cleanly.

### Modified Capabilities
- `runtime-status-endpoint`: The `/status` payload gains a lifecycle `state` field reflecting whether the process is running normally or draining toward shutdown.
- `docker-deployment`: The pre-swap drain moves from an external `GET /status` poll into the process; the deploy stops the old container with a bounded `docker stop -t <budget>` and the `/deploy` skill surfaces the process-side drain phase.

## Impact

- **Code:** `src/index.ts` (shutdown handler → drain sequence), `src/slack/handlers/core.ts` (`processMessage` quiesce gate), `src/changes/execution.ts` (`executeChange` quiesce gate), `src/cronScheduler.ts` (cron dispatch quiesce gate), `src/slack/activeRuns.ts` + `src/changes/activeState.ts` (enumerate/await in-flight handles), `src/statusServer.ts` (`state` field). A new small module owns the quiescing flag + drain orchestration.
- **Deploy:** `scripts/gce-update-image.sh` (drop external poll, `docker stop -t <budget>`), `.claude/skills/deploy` (drain-phase markers).
- **Behavior:** No user-facing feature change during normal operation; only alters shutdown/deploy behavior. New work is briefly refused during a deploy's drain window (interactive users see an ephemeral notice; cron self-heals).
- **Config:** Grace budget surfaced as an env/config knob (reuses the existing `DRAIN_MAX_WAIT` convention, default 300s).
- **Restart-policy note:** A clean `exit(0)` from a *bare* signal would be resurrected by Docker's `--restart unless-stopped`; the drain-then-exit contract is intended to be driven by `docker stop` (the deploy path), which marks the container stopped and suppresses restart.

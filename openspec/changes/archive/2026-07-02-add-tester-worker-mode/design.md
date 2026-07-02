## Context

Clack runs Claude *over* a repo's code and never boots the repo's application. The Changes Workflow already provisions runnable worktrees: `worktree_setup_instructions.md` assigns unique ports, lays down a working `.env`, and runs install; the reusable pool keeps these warm; and `resumeRemoteBranch` (cold-PR resume) already checks a branch out from its own remote head preserving PR commits. Worker mode assembles a flat, per-mode tool set in `buildWorkerTools` (`src/tools/server.ts`), and `filesUploadV2` already delivers files to Slack threads (error reports).

What is missing to answer "test this PR": keeping the app process *up*, driving it in a browser, capturing a video, and tearing it all down — without bloating the default deployment for the majority of installs that won't use this.

The deploy target is a single GCE VM running Clack via Docker (`node:22-alpine`), image-swapped by `scripts/gce-update-image.sh`.

## Goals / Non-Goals

**Goals:**
- A tester run that boots a PR branch's app, seeds data, drives it, records an `mp4`, and uploads to Slack and/or GitHub.
- Reuse worktree provisioning, `resumeRemoteBranch`, and `filesUploadV2` rather than reinvent them.
- Keep the tester strictly *less* privileged than a worker (no code/PR writes).
- Keep the default Clack image and deploy untouched; the feature is opt-in at both the config and deploy layers.

**Non-Goals:**
- A human-driven live preview environment (the earlier "who drives" fork resolved to Claude-driven only).
- Per-run ephemeral browser containers via the Docker socket (deferred; the sidecar covers v1).
- Any GitHub delivery of the recording in v1 (deferred to a follow-up change; note the REST API cannot attach video to a PR/issue comment — branch commit or release asset are the eventual options).
- Making tester a new *Slack trigger mode* — it is a task/toolbelt variant of the worker execution model, not a new entry point alongside reactions/DMs/mentions.

## Decisions

### Decision: Tester is a derived worker, not a new mode

Tester reuses the worker execution chassis (worktree acquisition → run Claude in it → teardown). The only real forks are the **toolbelt** and the **terminal deliverable**. Model this with a discriminator on the change intent/plan (e.g. `kind: "implement" | "test"` on `ChangePlan`/the staged intent in `src/changes/types.ts`), read by `buildClackTools` to select the tester branch in `buildWorkerTools`.

- **Why**: worker mode ends with `ensure_pr`; tester ends with `record_and_upload`. Everything before (provision, boot, run) is shared. A discriminator keeps one execution model rather than forking `executeChange`.
- **Alternative considered**: a flag on worker mode that just swaps the final tool. Rejected — the *permission* difference (no push/PR tools, read-only git) is a safety boundary that deserves an explicitly gated tool set, not a runtime branch inside a fully-privileged worker.

### Decision: Playwright in an opt-in sidecar container

Run the **Playwright MCP server itself** as a separate `clack-playwright` container using the official `mcr.microsoft.com/playwright/mcp` image (browser + server versions guaranteed to match): HTTP transport (`--host 0.0.0.0 --port 8931`), `--headless`, and video recording enabled via the MCP's `--config` file (`browser.contextOptions.recordVideo.dir` — verified against `@playwright/mcp@0.0.77`'s config schema; there is no `--save-video` CLI flag). Clack's main Alpine image carries **no Playwright footprint at all** — it registers the sidecar as a remote MCP server (an entry pointing at `http://clack-playwright:<port>/mcp`) for tester runs only. Because the MCP owns the browser session, the recording MUST come from that session: the sidecar writes video to a **shared volume** mounted by both containers, and `record_and_upload` reads it from there (a second Playwright client `connect()`ing from the main container would get its own browser instance and could never reach the MCP session's recording — which also makes client/server version pinning a non-issue, since client and browser are co-located in the sidecar). ffmpeg then transcodes `webm→mp4` in the **main** container (an `ffmpeg` apk, ~80MB static package) — running it in the sidecar would require an exec channel into that container (docker-socket access, already rejected). The repo has no docker-compose today (Dockerfile + `scripts/gce-update-image.sh` only), so the sidecar's deploy form — an introduced compose file with an opt-in profile, or a conditional `docker run` in the deploy script — is part of this work.

- **Why**: baking browsers into the main image would force a ~1.5GB image and browser attack surface on *every* install for a feature most won't use. The sidecar quarantines the heavy deps and is only deployed when wanted. Alpine's musl also makes native Playwright unsupported — the Ubuntu sidecar sidesteps that entirely.
- **Alternatives considered**: (a) bake into main image + config flag — rejected (bloats all installs); (b) Alpine + system `chromium` apk in the main image — keeps it lean but reintroduces musl/version-drift fragility and still ships the browser everywhere; (c) per-run container via `/var/run/docker.sock` — best isolation but needs privileged socket access on the VM, deferred past v1.

### Decision: Two-layer opt-in with graceful degradation

Layer 1 — deploy: the sidecar is a separately-deployed container (compose profile or deploy-script conditional); not standing it up leaves the feature inert. Layer 2 — config: `config.tester.enabled` gates tool/action/Home-Tab registration. When the flag is on but the sidecar is unreachable, tester tools degrade with a clear message (same pattern as trivia's "no image-search tool installed" fallback) rather than erroring hard.

- **Why**: mirrors how the codebase already handles optional capabilities; a half-configured install fails soft.

### Decision: Claude drives the browser via the official Playwright MCP

The official Playwright MCP is the driving surface, running **inside the sidecar** (where the browser lives) and exposed over HTTP; Clack registers it as a remote MCP server for tester runs only — no browser or Playwright client ever runs in the main container. Claude drives interactively — navigate, click, fill, observe — through existing MCP plumbing (registry, attach machinery, task-card tool labels).

- **Why**: interactive driving matches Claude's observe-then-act loop and reuses Clack's MCP infrastructure wholesale.
- **Alternative considered**: Bash-invoked Playwright scripts wrapped by a tester tool — more deterministic and replayable, but every drive step becomes a slow write-run-inspect cycle. Rejected for v1.

### Decision: Deliverable is mp4, Slack-only in v1

Record `webm`, transcode to `mp4` for reliable inline playback, upload via `filesUploadV2` into the originating thread. GitHub delivery is deferred to a follow-up change — a GitHub delivery request is declined with an explanation. When it lands it must use an API-supported form (branch commit or release asset), never a PR/issue-comment attachment (web-UI-only, unsupported by the REST API).

- **Why**: `filesUploadV2` is proven and the Slack thread is where the requester already is; cutting GitHub delivery removes the largest unresolved surface (target form, binary blobs in history vs release clutter) from v1.

### Decision: Concurrency via the worker-pool queue with a separate tester cap

Tester acquisitions flow through the existing worker-pool queue; a separate tester concurrency cap (default 1) bounds simultaneous tester runs, and requests beyond the queue bound are rejected with a clear message (the existing `PoolExhausted` pattern).

- **Why**: the queue, cancellable entries, and exhaustion semantics already exist and are tested — a parallel tester queue would duplicate them for no isolation benefit.
- **Disposable-mode caveat**: the queue exists only in the reusable pool. In disposable mode there is nothing to queue on — the tester cap degrades to reject-when-busy ("a test is already running").

### Decision: Explicit process teardown by port/PID

A tester run boots a long-lived dev server — a first for Clack, where every Bash call is otherwise short-lived. Teardown must kill that process by port/PID in a `finally`-style path, independent of `removeWorktree` (which only `rm -rf`s files and does not kill processes).

- **Why**: without it a crashed run leaks a dev server and holds a port, breaking the next acquire.
- **Refinement from the first live run**: the tracked pid is often a wrapper (`npx`/`pnpm`) whose real server child survives a single-pid kill while keeping the wrapper's process group — teardown signals the group (`-pid`) as well as the pid, and the prompt re-points the tracked pid at the actually-listening process after the health check. `lsof` is required in the main image for the port sweep (added to the Dockerfile).

## Risks / Trade-offs

- **Leaked app process / held port** → explicit port/PID kill on every exit path (normal, error, cancel); verify the port is free before reuse.
- **Recording mechanism** (resolved by the spike): video is enabled through the MCP's `--config` file (`browser.contextOptions.recordVideo`), not a CLI flag — verified against `@playwright/mcp@0.0.77`. End-to-end capture on the shared volume still needs the live-deploy verification (task group 8); fallback remains Bash-invoked Playwright scripts in the sidecar.
- **Dev server unreachable from the sidecar** → container-to-container traffic requires the app to bind `0.0.0.0`, but most dev servers default to `127.0.0.1`; the tester prompt / per-repo `test_instructions.md` must ensure a non-localhost bind (e.g. `HOST=0.0.0.0`).
- **Video is mostly idle time** (Claude thinks 10–60s between MCP actions) → optionally speed up or trim idle gaps during the ffmpeg transcode; v1 may ship unedited.
- **Resource exhaustion on the GCE VM** (Chromium + dev server + worker + Claude simultaneously) → hard-cap tester concurrency (default 1–2); document the added RAM envelope; queue or reject beyond the cap.
- **Sidecar image size (~1.5GB)** → only pulled/deployed when the feature is enabled; irrelevant to default installs.
- **Sidecar browser cannot reach the dev server** → require the sidecar and main container on a shared Docker network; the browser targets the worktree's assigned port.
- **Flaky app boot / slow readiness** → health-check with timeout before driving; on boot failure, report status and tear down cleanly rather than record a blank session.
- **Video of a broken app is still "success"** → the recording is an artifact, not a pass/fail verdict; Claude's `report_status` narrates what it observed alongside the video.

## Migration Plan

1. Ship dormant: add the `tester` config block (default `enabled: false`) and the sidecar compose profile without standing it up. No behavior change for existing installs.
2. Land the derived-worker toolbelt, `run_test` action, `record_and_upload`, and the Playwright client wrapper behind the disabled flag.
3. Enable in a test install: stand up the sidecar, flip `enabled`, exercise a "test this PR" round-trip end to end.
4. Rollback: flip `enabled` off and/or remove the sidecar service — the feature goes inert with zero residual effect on worker/query modes.

## Open Questions

None outstanding — the four questions raised during drafting were resolved during review: GitHub delivery is deferred (Slack-only v1), concurrency reuses the worker-pool queue with a separate cap, `test_instructions.md` is a per-repo override with a built-in fallback from day one, and the browser driver is the official Playwright MCP. See the Decisions above.

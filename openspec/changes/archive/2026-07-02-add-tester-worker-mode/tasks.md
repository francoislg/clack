## 1. Config gate (dormant)

- [x] 1.1 Add a `tester` block to `src/config.ts` (`enabled`, sidecar endpoint, concurrency cap) with `enabled` defaulting to `false`
- [x] 1.2 Add the zod schema for the `tester` block in `configZod.ts`/`configSchemas.ts` (fail-fast reader; `safeParse` → formatted throw)
- [x] 1.3 Add config tests covering absent block, `enabled: false`, and a fully-populated block
- [x] 1.4 Verify: with the block absent or disabled, boot is unchanged and no tester surface registers

## 2. Intent discriminator + tester toolbelt

- [x] 2.1 Add a `kind: "implement" | "test"` discriminator to the staged change intent and `ChangePlan` in `src/changes/types.ts` (default `"implement"`)
- [x] 2.2 Thread the discriminator through intent → plan → execution, mirroring how `resumeRemoteBranch` is threaded — including `BuildWorkerContextParams` in `src/tools/context.ts` so `WorkerToolContext` carries it into `buildWorkerTools`
- [x] 2.3 Add a tester branch in `buildWorkerTools` (`src/tools/server.ts`): include `report_status` and `record_and_upload`, omit `git_push`/`ensure_pr`/`merge_pr`/`close_pr`; attach the Playwright MCP for tester runs
- [x] 2.4 Ensure git access in the tester branch is read-only (no push remote refresh / no write paths)
- [x] 2.5 Add tests asserting the tester tool set omits every PR/code-mutating tool and includes the recording tool

## 3. run_test action tool

- [x] 3.1 Create `src/tools/actions/runTest.ts` mirroring `propose_change`: resolve target repo + branch/PR, stage a `kind: "test"` intent, gate to dev+
- [x] 3.2 Register `run_test` only when `config.tester.enabled` is true
- [x] 3.3 Wire the staged test intent to acquire a worktree with `resumeRemoteBranch: true` set unconditionally — a tester always checks out the PR branch's own remote head (fail on missing remote branch)
- [x] 3.4 Add tests: dev+ can stage; below-dev cannot; missing remote branch fails cleanly

## 4. Tester execution lifecycle

- [x] 4.1 Add per-repo `tester_data_setup_instructions.md` resolution (reuse `resolveInstructionFile`); run after boot, skip when absent
- [x] 4.2 Add per-repo `test_instructions.md` resolution (reuse `resolveInstructionFile`), falling back to a built-in prompt in `src/tester/prompt.ts`, driving boot → seed → drive → record → report
- [x] 4.3 Boot the app in the worktree with a health-check (HTTP-poll the worktree's assigned port until ready, default 120s, driven by the tester prompt) ensuring the dev server binds `0.0.0.0` so the sidecar browser can reach it, and enforce the overall run timeout (changes-workflow `timeoutMinutes` pattern); on boot failure or timeout, report status and tear down cleanly
- [x] 4.4 Implement app-process teardown in `src/tester/processTeardown.ts` (kill the tracked PID, port-lookup fallback) invoked on every exit path (success, error, cancel, timeout), independent of `removeWorktree`
- [x] 4.5 Route tester acquisitions through the existing worker-pool queue with a separate tester cap (default 1, from `config.tester`); reject beyond the queue bound with a clear message (`PoolExhausted` pattern) — in disposable mode (no queue) degrade to reject-when-busy
- [x] 4.6 Tests: seeding runs/skips correctly; teardown kills the process on normal and crash paths; concurrency cap enforced

## 5. Playwright sidecar + client

- [x] 5.1 SPIKE (done — mechanism corrected): `@playwright/mcp@0.0.77` has NO `--save-video` flag; video recording is enabled via its `--config` file (`browser.contextOptions.recordVideo.dir`, verified in the package's `config.d.ts`), and the official `mcr.microsoft.com/playwright/mcp` image removes browser/server version matching. Live end-to-end capture verified in task 8.1
- [x] 5.2 Add the `clack-playwright` sidecar service (`docker-compose.tester.yml`, official `mcr.microsoft.com/playwright/mcp` image + `docker/clack-playwright/config.json`) on the shared `clack` network, recordings under `data/tester/recordings` (already a mounted volume for the main container)
- [x] 5.3 Register the sidecar's MCP endpoint as a remote MCP server attached for tester runs only (no Playwright npm dependency in the main image); add tool-mapping labels for its tools (`tool_mapping/playwright.json`)
- [x] 5.4 Implement graceful degradation when the sidecar is unreachable: reachability check at run start, abort with a clear message before booting the app, no partial artifact
- [x] 5.5 Tests: sidecar reachability check (mocked), unreachable-sidecar abort path, missing-recording-on-volume configuration error

## 6. Recording + upload

- [x] 6.1 Record the session headlessly via the MCP config's `recordVideo`; locate the run's `webm` on the shared recordings volume (configuration error if absent)
- [x] 6.2 Transcode `webm→mp4` with ffmpeg in the main container (add the `ffmpeg` apk to the Dockerfile), invoked by `record_and_upload` on the volume's file
- [x] 6.3 Create `src/tools/worker/recordAndUpload.ts` (+ `recordAndUpload.test.ts`): upload `mp4` to the Slack thread via `filesUploadV2`
- [x] 6.4 Decline GitHub delivery requests with an explanation (Slack-only v1; GitHub delivery deferred to a follow-up change) while still uploading to the Slack thread
- [x] 6.5 Tests: Slack upload path, Slack upload failure narration, GitHub-request declined path, `webm→mp4` invoked

## 7. Surface + docs

- [x] 7.1 Add a tester surface to the Home Tab: active runs render as a "N testing" line in the Workers section (both pool modes)
- [x] 7.2 Route all direct-to-Slack tester strings through `t()` (add EN + FR keys) — sidecar-unreachable notice, run-rejected notice, not-enabled notice, Workers testing count; keep Claude-facing tool results English
- [x] 7.3 Document the tester feature, sidecar deploy (local + GCP profiles), and resource envelope in `CLAUDE.md` and `docker-compose.tester.yml`
- [x] 7.4 Run `npx tsc --noEmit`, `npx oxlint`, `npx oxfmt --check`, and the full test suite (412 files / 6486 tests green); run `graphify update .`

## 8. End-to-end verification

> Recording pipeline verified locally (2026-07-02): `docker-compose.tester.yml` up → reachability probe (HEAD → 400, correctly counted reachable) → MCP handshake (Playwright 1.62.0-alpha) → `browser_navigate` → context close → `.webm` landed in `data/tester/recordings/` → alpine-ffmpeg `webm→mp4` transcode OK. Remaining below: the full Slack round-trip on a live install.
>
> Live tester session verified locally (2026-07-02) via `scripts/askClaudeTester.ts` against a real repo's dev preview server: Claude booted the app itself, health-checked it, drove the sidecar browser (navigate/snapshot/screenshot/click across templates), visually confirmed the change under test, closed the browser, and reported — 117s end-to-end, recording verified as watchable mp4. **Findings fixed from this run:** (1) the tester killed the `npx` wrapper pid, orphaning the real server child on its port, and left no `.clack-tester-app.json` for the harness backstop → `teardownAppProcess` now signals the process **group** (`-pid`) as well as the pid, the prompt re-points the tracked pid at the actually-listening process after health-check (`lsof -ti tcp:<port>`) and forbids deleting the info file; (2) `lsof` was missing from the alpine main image, so the port-sweep fallback would silently no-op in Docker → added to the Dockerfile apk line. Still open: `lsof`-in-container and the GCP `appHost: "clack"` service-name path are only verifiable during 8.1.

- [x] 8.1 Stand up the sidecar in a test install, flip `enabled`, and run a "test this PR" round-trip
- [x] 8.2 Confirm the mp4 lands in the Slack thread and plays inline
- [x] 8.3 Confirm the app process and port are released after the run, and no worktree/branch was mutated

> Live GCE round-trip verified (2026-07-02): `gce-update-image.sh` deployed the image + sidecar (Phase 2.5, added during rollout — COS has no compose, so the deploy mirrors `docker-compose.tester.yml` as `docker run` on a shared `clack` docker network); `run_test` staged from a real thread; the tester booted the target repo's API server in `worker-1` (`HOST=0.0.0.0 pnpm start`), drove the sidecar browser across two recorded segments, transcoded (2.8 MB mp4) and delivered to the thread — video plays inline. Teardown: tracked pid killed, port freed, `.clack-tester-app.json` removed. Resource envelope on the 4 GB VM: memory bottomed at ~127 MB free during app-boot + browser overlap; CPU saturated in bursts; no OOM/throttle — one concurrent tester run is the practical ceiling.
>
> Known follow-ups from the live run (not blocking): (1) supervisor wrappers (`pnpm`/`nodemon`/`bunyan`) survive teardown — add a worktree-path `pgrep -f` sweep to `teardownAppProcess`; (2) multi-segment sessions deliver only the newest recording — decide largest-vs-newest or prompt guidance to keep one page; (3) pre-existing: Home Tab publish fails at Slack's 100-block cap on busy installs.

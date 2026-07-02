## Why

Clack today only ever runs Claude *over* a repo's code — read, reason, edit, commit. It has never run the **user's actual application as a live process**. Reviewers still have to check out a PR, boot it, seed data, and click through the change by hand to see whether it actually works. A "test this PR" request in a thread should let Clack do that QA pass itself and hand back a **video** of the app exercising the change.

## What Changes

- Introduce a **tester** execution model: a *reduced-privilege derived worker* that reuses the existing worktree provisioning (branch checkout, ports, `.env`, install) but ends with a **QA + recording** deliverable instead of a PR.
- Add a `run_test` action tool (mirrors `propose_change`): dev+ users say "test this PR" in a thread; Claude stages a test intent that acquires a worktree on the PR's branch (via the existing `resumeRemoteBranch` cold-PR resume path), boots the app, seeds data, drives it, records, and uploads.
- Gate the tester toolbelt so it is strictly **less** privileged than a worker: **no** `git_push` / `ensure_pr` / `merge_pr` / `close_pr`, git is **read-only**. It gains browser-driving and a `record_and_upload` tool.
- Add a **video pipeline**: drive a headless browser via the official **Playwright MCP server running inside an opt-in sidecar container**, registered as a remote MCP server for tester runs (Clack's main Alpine image carries no Playwright footprint at all). The MCP records `webm` to a shared volume; ffmpeg in the main image transcodes to `mp4` (the sidecar has no exec channel); upload to the Slack thread (`filesUploadV2`, already used for error reports). GitHub delivery is deferred to a follow-up change.
- Add per-repo `tester_data_setup_instructions.md` (same pattern as `worktree_setup_instructions.md`) for seeding test data.
- Make the whole feature **opt-in** at two layers: a `tester.enabled` config gate (registers tools / action / Home Tab surface) **and** the deploy layer (the sidecar is a compose profile — not stood up, feature is inert). When the flag is on but the sidecar is unreachable, tester tools **degrade gracefully** rather than fail hard.
- Guarantee **process teardown**: a tester run boots a long-lived dev server (a first for Clack), so the app process must be killed by port/PID on teardown, independent of worktree removal.

## Capabilities

### New Capabilities
- `tester-mode`: the tester execution model — trigger detection, the `run_test` action intent, the reduced-privilege toolbelt, worktree acquisition on a PR branch, app boot + data seed + QA drive + teardown lifecycle, and the config/enablement gate.
- `test-recording`: the video pipeline — the Playwright sidecar contract, the Playwright MCP driver surface, headless record → `mp4` transcode, and upload to the Slack thread (GitHub delivery deferred; note the REST API cannot attach video to a PR comment).

### Modified Capabilities
<!-- No existing spec's REQUIREMENTS change; tester reuses worker-pool / changes-workflow / docker-deployment behavior additively. New behavior is captured in the two new capabilities above. -->

## Impact

- **New code**: `src/tools/actions/runTest.ts` (action tool); a tester branch in `buildWorkerTools` (`src/tools/server.ts`) with its own gated tool set; `src/tools/worker/recordAndUpload.ts`; a tester execution path alongside `executeChange` (`src/changes/execution.ts`) or a discriminator on the change intent/plan (`src/changes/types.ts`); a Playwright-sidecar client wrapper.
- **Config**: new `tester` block in `src/config.ts` / `configZod.ts` (`enabled`, sidecar endpoint, tester concurrency cap); validated via zod like all config.
- **Docker/deploy**: new `clack-playwright` sidecar service (`mcr.microsoft.com/playwright` base running `@playwright/mcp` over HTTP) — the repo has no docker-compose today, so its deploy form (introduced compose file with opt-in profile, or a conditional `docker run` in `scripts/gce-update-image.sh`) is part of this work; main image adds only the `ffmpeg` apk for transcode. Shared Docker network (the worktree dev server must bind `0.0.0.0` to be reachable) plus a shared recordings volume.
- **Dependencies**: `ffmpeg` (apk) in the main image; `@playwright/mcp` lives in the sidecar only.
- **Per-repo config**: optional `tester_data_setup_instructions.md`; optional `test_instructions.md` prompt override.
- **Resource envelope**: a tester run adds Chromium + the app dev server on top of the worker + Claude; tester concurrency is capped hard (1–2) and is heavier than any existing run mode.

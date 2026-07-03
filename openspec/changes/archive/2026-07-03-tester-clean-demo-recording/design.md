# Design: tester-clean-demo-recording

## Context

A tester run drives the app through the Playwright MCP sidecar, whose static config (`docker/clack-playwright/config.json`) sets `browser.contextOptions.recordVideo` — every browser context is recorded from creation to close, one `.webm` per context, written to the shared recordings volume. `record_and_upload` (`src/tools/worker/recordAndUpload.ts`) picks the newest `.webm`, transcodes it to mp4 with a bare `ffmpeg -y -i in.webm out.mp4`, and uploads it to the Slack thread.

Two independent sources of dead video:

1. **Exploration** — the tester's single browser session includes discovery, wrong turns, and verification poking, all recorded.
2. **Inter-action idle** — between every browser tool call, Claude reasons for seconds to tens of seconds while the browser sits frozen. This dominates: even a tight walkthrough is mostly frozen frames.

The current prompt (`TESTER_SYSTEM_PROMPT`, `src/tester/prompt.ts`) actively frames the whole session as the recording ("the session is being recorded, so make the walkthrough tell a story").

## Goals / Non-Goals

**Goals:**

- The uploaded video is a short, watchable demo of the verified behavior (working feature → clean demo; broken feature → clean reproduction).
- Frozen stretches inside the demo are removed/compressed so mp4 duration tracks activity, not wall-clock time.
- Zero new tools, config keys, sidecar/docker changes, or deploy-script changes.

**Non-Goals:**

- Cleaning up leftover verify-take `.webm` files (retention unchanged — nothing cleans the recordings dir today).
- Screenshot/proof artifacts posted to the thread (evidence stays free-text narration via `report_status`).
- A structured verdict field on `report_status`.
- Timestamp-based video trimming (fallback only, if the per-context assumption fails).

## Decisions

### D1: Two-phase workflow is prompt-only; "reopen = start recording"

The sidecar records **per browser context**, so closing the browser after verification and reopening it for the demo naturally yields a separate, demo-only video file. The prompt rewrite frames this explicitly for Claude: phase 1 VERIFY (throwaway session — explore, confirm behavior, gather evidence from snapshots/console/network), `browser_close`, phase 2 RECORD (reopen = recording starts; deliberate walkthrough of exactly what phase 1 established; close = recording ends), then `record_and_upload`.

- *Alternative — runtime recording toggle*: impossible; the MCP's `recordVideo` is static context config with no start/stop surface.
- *Alternative — one session + ffmpeg trim from a timestamp marker*: fragile wall-clock→video-time mapping, and the result is a cropped fumble, not a rehearsed demo. Kept only as the documented fallback if D4's verification fails.

`findLatestRecording`'s newest-wins selection needs no change: the demo context closes last, so its `.webm` has the newest mtime. `video_file` stays as the explicit escape hatch and the prompt mentions it.

### D2: Condense in the existing transcode with mpdecimate + setpts

`transcodeToMp4` gains a video filter chain:

```
ffmpeg -y -i in.webm -vf "mpdecimate=max=<N>,setpts=N/FRAME_RATE/TB" out.mp4
```

- `mpdecimate` drops near-duplicate frames (the frozen thinking stretches).
- `max=<N>` is the **pace floor**: at most N consecutive frames are dropped, so a frozen stretch compresses to ~1/(N+1) of real time instead of vanishing — clicks don't fire machine-gun style and cause/effect stays followable. N is a named constant in `recordAndUpload.ts`, tuned against a real recording during implementation (starting point: ~12 at 25fps ≈ frozen time played at ~13×).
- `setpts=N/FRAME_RATE/TB` re-times the surviving frames to a uniform rate.

Recordings have no audio track, so no desync concern. Animated loading spinners survive decimation (pixels change) but are compressed by the demo take being short and deliberate.

- *Alternative — uniform speed-up (e.g. 8×)*: makes real interactions unwatchably fast; rejected.
- *Alternative — `freezedetect` + segment cutting*: two-pass, much more ffmpeg plumbing for the same outcome; rejected.

### D3: Prompt structure of the rewrite

`TESTER_SYSTEM_PROMPT` workflow steps 6–7 split into VERIFY and RECORD phases; the "session is being recorded" framing is replaced by "the demo session is the video". Phase 2 explicitly covers the broken case: if verification showed the feature failing, the demo take is a clean minimal reproduction of the failure. Boot/health-check/seed steps (1–5) and teardown/report steps (8–9) are unchanged. The app process boots ONCE and stays up across both phases — only the browser session restarts between verify and demo; the prompt must not suggest re-booting the app. Existing per-repo `test_instructions.md` overrides continue to append after the built-in workflow, unaffected.

### D4: Verify the per-context assumption before landing the prompt

The design rests on: the Playwright MCP relaunches a fresh context after `browser_close` mid-session, and each context writes its own video file. Confirm against the live sidecar (drive it manually: navigate → close → navigate → close → inspect the recordings volume for two `.webm`s) as the first implementation task. If it does not hold, stop and fall back to the timestamp-trim design (new proposal — out of scope here).

**Spike findings (2026-07-03, two runs, consistent):** CONFIRMED. Driving the live sidecar over streamable HTTP (navigate → close → navigate → close): the MCP relaunches a fresh context after the mid-session `browser_close`; each context writes its own `page@<hash>.webm` (flat in the recordings dir); the second take's file had the newer mtime in both runs, so newest-wins selection picks the demo. One observation: with a minimal curl client (no persistent SSE stream), the second `browser_close` returned "Session not found", yet the video still finalized on disk — the sidecar auto-closes the browser (finalizing the recording) on session teardown. Attributed to the bare client; the Agent SDK holds a persistent MCP session and the close→upload sequence already works in production runs today. Worst case, an errored demo-close still leaves a finalized demo video for `record_and_upload`.

## Risks / Trade-offs

- [Playwright MCP does not relaunch after `browser_close`] → D4 spike runs first; fallback design identified before any prompt change lands.
- [mpdecimate drops meaningful subtle changes (tooltip fades, caret blinks)] → acceptable for a QA demo; `max=<N>` floor guarantees periodic frames survive even in near-static stretches.
- [Verify take's `.webm` is newer than the demo in a pathological ordering (e.g. Claude never closes the demo browser)] → the prompt keeps the explicit "close the browser, then upload" step; `video_file` remains the manual override; failure mode is the old behavior (whole-session video), not a broken run.
- [Filter chain fails on some webm variant] → transcode failures already surface via the existing `errorResult` path ("nothing was uploaded"); implementation validates against a real sidecar recording.
- [Two browser sessions lengthen total run time] → phase 2 is short by construction; the verify phase replaces (not adds to) today's exploratory driving.

## Open Questions

- ~~Pace-floor value `max=<N>`: tune by watching one real condensed recording during implementation (start at 12).~~ **Resolved: N=12.** Measured against a real 49.8s sidecar recording (25fps): N=6 → 9.4s, N=12 → 6.3s, N=24 → 4.9s. N=12 keeps a ~0.4s visible beat per 5s of frozen time (idle plays at 13×); N=24 erases pauses to the point of hurting cause/effect readability for marginal savings.

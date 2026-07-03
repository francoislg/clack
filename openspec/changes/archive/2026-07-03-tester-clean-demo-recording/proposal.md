# Proposal: tester-clean-demo-recording

## Why

Tester runs currently deliver a video of the *entire* browser session — exploration, wrong turns, and long frozen stretches while Claude thinks between tool calls. A typical artifact is a 7-minute video where almost nothing happens; the useful content is a fraction of it. The recording should be a short, watchable demo of the verified behavior.

## What Changes

- **Two-phase tester workflow (prompt-only)**: rewrite the tester system prompt so the run first VERIFIES the change in a throwaway browser session (gathering evidence via snapshots/console/network), closes the browser, then reopens it for a deliberate, scripted demo walkthrough of exactly what was verified. Since the Playwright sidecar records per browser context, the reopen acts as the "start recording" button — the delivered video covers only the demo take. Works for both outcomes: a working feature gets a clean demo; a broken one gets a clean reproduction.
- **Condensed transcode**: the existing `webm→mp4` ffmpeg step in `record_and_upload` additionally drops near-duplicate frames (`mpdecimate` + `setpts` re-timing, with a pace floor so playback stays human-followable), removing the frozen stretches between browser actions inside the demo take.
- **Leftover recordings unchanged**: the verify take still produces a `.webm` on the shared volume (sidecar recording is static, per-context). No cleanup is added — files accumulate exactly as they do today.
- **No tool, config, or sidecar changes**: `record_and_upload`'s newest-wins recording selection already picks the demo take (it closes last); `video_file` remains the explicit escape hatch.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `test-recording`: the delivered recording changes from "the whole session" to "a condensed demo take" — (1) the run verifies before it records, and the uploaded video covers only the post-verification demo context; (2) the transcode condenses idle frames so the mp4's duration tracks activity, not wall-clock time.

## Impact

- `src/tester/prompt.ts` — `TESTER_SYSTEM_PROMPT` workflow rewrite (verify phase → demo phase; "the session is being recorded" framing replaced with "recording starts when you reopen").
- `src/tools/worker/recordAndUpload.ts` — `transcodeToMp4` gains the mpdecimate/setpts filter chain; tests updated to assert the ffmpeg args.
- `openspec/specs/test-recording/spec.md` — delta spec for the two requirements above.
- **Verification dependency**: the design rests on the Playwright MCP relaunching a fresh browser context after `browser_close` mid-session, with each context producing its own video file. This must be confirmed against the live sidecar before the prompt rewrite lands; if it doesn't hold, the fallback is timestamp-based trimming in the transcode step (kept out of scope unless needed).
- No config schema, sidecar image, docker, or deploy-script changes.

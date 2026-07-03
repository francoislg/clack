# Tasks: tester-clean-demo-recording

## 1. Spike — verify the per-context recording assumption (D4)

- [x] 1.1 Against the live Playwright sidecar (local compose), drive one MCP session: navigate → interact → `browser_close` → navigate again → interact → `browser_close`; confirm the MCP relaunches a fresh context after the mid-session close
- [x] 1.2 Confirm the recordings volume contains one `.webm` per context and the second (demo) file has the newer mtime; if either check fails, STOP — record findings in design.md and re-scope to the timestamp-trim fallback

## 2. Condensed transcode

- [x] 2.1 Add the `mpdecimate=max=<N>,setpts=N/FRAME_RATE/TB` filter chain to `transcodeToMp4` in `src/tools/worker/recordAndUpload.ts`, with the pace-floor `N` as a named constant
- [x] 2.2 Update `recordAndUpload.test.ts`: assert the ffmpeg invocation includes the filter chain (stubbed exec), and keep the existing transcode-failure path covered
- [x] 2.3 Run the new transcode against a real sidecar `.webm` (from the 1.1 spike); watch the output, tune `N` so frozen stretches compress but cause/effect stays followable, and record the chosen value in design.md (resolves the open question)

## 3. Two-phase tester prompt

- [x] 3.1 Rewrite `TESTER_SYSTEM_PROMPT` in `src/tester/prompt.ts`: split the drive/record steps into VERIFY (throwaway session, evidence-gathering, close) and RECORD (reopen = recording starts, deliberate walkthrough of the verified behavior — clean demo when working, minimal reproduction when broken, close = recording ends), keeping boot/health/seed and teardown/report steps unchanged
- [x] 3.2 Drop the "session is being recorded" framing; state that the newest recording is the demo take and that `video_file` on `record_and_upload` is the override if takes get out of order
- [x] 3.3 Update `prompt.test.ts` assertions for the new workflow wording (two-phase presence, unchanged repo-override and data-setup sections)

## 4. Specs & verification

- [x] 4.1 Run `npx tsc`, `npm test`, and `npx oxlint` / `npx oxfmt` on `src/tester/prompt.ts`, `src/tester/prompt.test.ts`, `src/tools/worker/recordAndUpload.ts`, `src/tools/worker/recordAndUpload.test.ts`
- [x] 4.2 Validate the pipeline end-to-end to the extent reachable pre-deploy: live-sidecar two-take spike (fresh context per reopen, demo take newest), real 49.8s recording transcoded through the exact `buildTranscodeArgs` chain (→ 6.3s), and the `TESTER_SMOKE=1` sidecar pipeline test (now invoking `buildTranscodeArgs`) green. The full Slack-triggered "test this PR" run needs the deployed bot + a human action in Slack — it is the post-deploy verification: confirm the uploaded mp4 is the condensed demo take and the verify `.webm` is left on the volume
- [x] 4.3 Validate the change with `openspec validate tester-clean-demo-recording --strict`

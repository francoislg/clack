## 1. Tester prompt hard rule

- [x] 1.1 Add the turn-end hard rule to `TESTER_SYSTEM_PROMPT` in `src/tester/prompt.ts` (run ends when the turn ends; notifications only arrive while the turn is open; poll with Bash, never end the turn to wait)
- [x] 1.2 Add `buildTesterCorrectivePrompt({ includeSetupRewrite })` to `src/tester/prompt.ts` — finish-now instruction (close browser session, `record_and_upload` what exists, `report_status`), with the setup-entry rewrite paragraph gated on the flag
- [x] 1.3 Unit tests in `src/tester/prompt.test.ts`: hard rule present in every assembled prompt; corrective prompt with/without the rewrite paragraph

## 2. Deliverable tracking in executeTest

- [x] 2.1 In `executeTest` (`src/changes/execution.ts`), wrap the caller's `onEvent` with a spy that records seen tool names; derive `deliveredRecording` / `deliveredReport` from `record_and_upload` / `report_status` tool-use events
- [x] 2.2 Unit test: the spy flags flip on matching tool-use events and stay false otherwise (mock the event stream via `_deps` / stubbed `runClaude`)

## 3. Salvage check

- [x] 3.1 Add a `setupEntryWasRewritten(kind, repoName, baselineUpdatedAt)` helper to `src/memory/setupMemory.ts` that re-fetches the entry and value-compares `updatedAt` against the pre-run baseline (missing entry → not rewritten; store error → log and treat as not rewritten, never throw). The baseline comes for free: `executeTest` already calls `loadSetupNotes` before the run, which returns entry metadata incl. `updatedAt` since commit b4f2618 — capture it there, no extra read
- [x] 3.2 Unit tests in `src/memory/setupMemory.test.ts` for the helper's return value (not gate behavior): rewritten-mid-run (changed `updatedAt`), untouched (equal), entry appeared where baseline was null, missing entry, store error

## 4. Gate + corrective resume + loud failure

- [x] 4.1 In `executeTest`, after a successful `runClaude` with neither deliverable flag set, run the corrective resume INSIDE the `try` (before `finally` teardown): `runClaude` with `resumeSessionId: capturedSdkSessionId`, same toolbelt/MCP servers/system prompt, corrective prompt from 1.2 with the wording from design Decision 3 (rewrite paragraph per 3.1), reduced timeout `min(15, configured)`
- [x] 4.2 Surface resume-fallback-to-fresh explicitly: add an optional `onResumeFallback` callback to `clackSession` (fired in both fallback paths in `src/claude/query.ts`), thread it through `runClaude`; in `executeTest` abort the corrective run on the signal (dedicated AbortController) and treat the attempt as failed
- [x] 4.3 Re-evaluate the deliverable flags over the resumed turn's events; on still-no-deliverable (or failed resume), return `{ success: false, error }` explaining the run ended without delivering — verify the existing failure path posts it to the thread; enforce exactly one corrective attempt
- [x] 4.4 Log gate decisions to the execution log (`deliverable gate: tripped/passed`, `corrective resume: delivered/failed`)
- [x] 4.5 Unit tests for `executeTest` gate flow: pass-through (report-only run), gate trip → resume delivers, resume also fails → loud failure, resume-fallback → loud failure, single-attempt enforcement, teardown still runs on every path

## 5. Verification

- [x] 5.1 `npx tsc`, `npx oxlint`, `npx oxfmt` on touched files; full `npm test`
- [x] 5.2 `openspec validate harden-tester-delivery-and-setup-memory --strict`
- [x] 5.3 `harden-setup-memory-loop` already landed (commit b4f2618, touching `executeTest` and `setupMemory.ts`) — verify the gate/resume hunks compose cleanly with its injection-logging code and that the salvage helper reuses its `loadSetupNotes` metadata rather than adding a parallel read path

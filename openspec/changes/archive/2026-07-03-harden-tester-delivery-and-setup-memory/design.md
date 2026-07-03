# Design — harden tester-run delivery and salvage setup-memory learnings

## Context

`executeTest` (`src/changes/execution.ts`) runs the tester as a single SDK `query()`: one prompt in, tool calls stream out, and the run is over the moment Claude ends its turn. The PR #4645 incident showed the failure shape: Claude armed `Monitor` background tasks and ended its turn "waiting" — the SDK emitted `result (subtype: success)`, `executeTest` mapped it straight to `{ success: true }` (execution.ts:632), and the harness marked the change session Completed with no recording, no status report, and no setup-memory rewrite.

Two facts make the fix cheap:

- `runClaude` already accepts `resumeSessionId` and the SDK wrapper (`src/claude/query.ts`) handles resume with a fresh-session fallback — a corrective second turn is one more `runClaude` call.
- `runClaude`'s `onEvent` stream already surfaces every `tool_use` with its name (it's what writes the `Event: tool_use (...)` lines in `execution.log`) — deliverable tracking needs no changes to the tools or the tool context.

## Goals / Non-Goals

**Goals:**

- A tester run can never end as a silent success without deliverables — it either delivers, or the thread gets a loud failure.
- One corrective resume gives the run a chance to finish (deliver + report + rewrite setup memory) with its full context intact.
- The turn-end trap is named in the tester prompt so Claude doesn't walk into it.

**Non-Goals:**

- No `Monitor`/task-tool disallowing — mid-turn background watches demonstrably helped and remain available.
- No transcript-parsing salvage engine — the corrective resume IS the salvage vehicle; offline extraction from JSONL stays a manual escape hatch.
- No changes to implement-mode worker runs (`executeImplement`) — their deliverable (a PR) already has the HEAD/PR no-op check; this change is tester-only.
- No retry loops — exactly one corrective resume, then loud failure.

## Decisions

### 1. Track deliverables by observing the event stream, not by instrumenting tools

`executeTest` wraps the caller's `onEvent` with a spy that records tool names seen (`record_and_upload`, `report_status`). Alternatives considered: (a) mutable flags on `WorkerToolContext` set inside each tool — touches three tool files and leaks harness concerns into the toolbelt; (b) checking side effects post-hoc (Slack uploads) — racy and needs Slack reads. The event stream is already the source of truth for `execution.log`; reusing it is zero-footprint.

### 2. Gate condition: neither `record_and_upload` NOR `report_status` was called

`report_status`-without-recording is a legitimate terminal state (boot failure, seed failure — the prompt explicitly says report and STOP). Recording-without-report is unusual but the recording is the primary deliverable. Only the both-absent case (the PR #4645 shape) means the run ended without telling anyone anything.

### 3. Corrective resume = salvage vehicle

On gate trip, `executeTest` calls `runClaude` again with `resumeSessionId: capturedSdkSessionId`, the same toolbelt/MCP servers/system prompt, and a corrective user prompt: your turn ended and nothing will wake you; background notifications are gone; finish NOW — close the browser session, `record_and_upload` what exists, `report_status` your observations, and (conditionally) rewrite the setup entry. The resumed session still holds the whole run in context, so setup-memory salvage costs one instruction instead of a transcript-extraction subsystem.

The rewrite instruction is included only when the setup entry wasn't touched during the run, checked by capturing the entry's `updatedAt` before the run (free — `executeTest`'s existing `loadSetupNotes` call returns entry metadata since `harden-setup-memory-loop` landed in b4f2618) and value-comparing it against a re-fetch at corrective-prompt assembly. Value equality, not wall-clock ordering, so clock precision and skew are irrelevant; no `remember`-call spying needed.

Resume uses a reduced timeout (default 15 minutes, `min(15, configured timeout)`) — it's a wrap-up turn, not a second run. If the SDK session can't be resumed (wrapper falls back to fresh — useless here, no context), or the resumed turn ALSO ends without deliverables, fall through to loud failure.

### 4. Teardown moves after the resume attempt

Today `teardownAppProcess` runs in `finally` immediately after the first `runClaude` returns. The corrective resume needs the app and browser session alive to finalize the recording, so the gate + resume run INSIDE the `try`; the `finally` teardown stays as the single exit-path cleanup (unchanged semantics for every other path).

### 5. Loud failure reuses the existing failure channel

When the gate trips and the resume doesn't produce a deliverable, `executeTest` returns `{ success: false, error: <explains the run ended without delivering> }` — the existing worker-failure delivery posts it to the thread, already localized. No new Slack surface.

### 6. Prompt hard rule, scoped to the real trap

Appended to `TESTER_SYSTEM_PROMPT` HARD RULES: the run ends the instant you stop calling tools — never end your turn to "wait" for a background task, monitor notification, bundle, or build; poll with Bash instead. Background task notifications only arrive while your turn is open. This corrects `Monitor`'s own "you will be notified" description at the only point where it lies in this environment.

## Risks / Trade-offs

- [Resumed run burns tokens on a doomed recording (app died with the turn)] → corrective prompt says "deliver what exists; if the recording is unusable, say so via report_status" — a report-only outcome passes the gate and the thread still learns what happened.
- [Resume lands on a fresh session via the wrapper's resume-fallback (no context — corrective prompt is meaningless)] → the wrapper gains an explicit `onResumeFallback` callback (session-id comparison is unreliable: a successful resume may mint a new id); `executeTest` aborts the fresh run on the signal and goes straight to loud failure. Worst case is today's behavior plus a clear error instead of silence.
- [Gate false-positive if a future tester variant legitimately ends another way] → the gate only fires on the both-absent case, and the corrective turn is harmless when Claude genuinely finished (it re-reports and ends).
- [`harden-setup-memory-loop` also touched `executeTest`] → it landed first (b4f2618); this change builds directly on its code (notes-injection logging, `loadSetupNotes` metadata) — verify composition rather than rebasing.

## Open Questions

- Should the deliverable gate also cover the run-*failed* path (timeout/abort)? Current scope: gate only on SDK success; failures already post loudly. A timed-out run's learnings die — acceptable for now, revisit if it recurs.

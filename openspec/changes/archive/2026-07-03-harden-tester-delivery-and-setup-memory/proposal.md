# Harden tester-run delivery and salvage setup-memory learnings

## Why

A live tester run (PR #4645, hub client) spent 45 minutes fighting Metro OOM kills, then armed background `Monitor` tasks and **ended its turn** with "let me wait for the final stretch notification" — expecting a task-notification to wake it up, as in interactive Claude Code. Under a one-shot SDK `query()` there is no wake-up: the run terminated as an SDK-level success, `executeTest` took `result.success` at face value, and the session was marked Completed with **zero deliverables** — no `record_and_upload`, no `report_status`, no setup-memory rewrite. The user saw Clack say "let me wait" and go silent forever, and the 45 minutes of hard-won hub-client setup knowledge (Metro OOM workarounds, ENOSPC patch, Host-header proxy) died with the run and had to be salvaged by hand from the SDK transcript.

## What Changes

- **Tester prompt hard rule (turn-end trap)**: `TESTER_SYSTEM_PROMPT` gains an explicit rule — the run ends the instant Claude stops calling tools; NEVER end the turn to "wait" for a background task notification or anything else; poll with Bash instead. `Monitor` stays available (mid-turn notifications demonstrably help), but its "you will be notified" contract is explicitly scoped to the open turn.
- **Deliverable gate in `executeTest`**: the tester tool context tracks whether `record_and_upload` or `report_status` was called. When the SDK run ends "successfully" without either, the run is NOT a success: `executeTest` resumes the SDK session once (`resumeSessionId` — already supported by `runClaude`) with a corrective prompt ("your run ended without delivering; nothing will wake you — finish now: deliver, report, and rewrite setup memory if warranted"). If the resumed run still delivers nothing, the run fails loudly to the thread instead of completing silently.
- **Setup-memory salvage**: the corrective resume doubles as the salvage vehicle — the resumed session still holds the full run context, so instructing it to rewrite the `tester-setup:<repo>` entry per the existing REPO SETUP MEMORY directive recovers learnings without any transcript parsing. The gate therefore also tracks whether `remember` wrote the setup entry, and the corrective prompt includes the rewrite instruction only when it didn't.

## Capabilities

### New Capabilities

_None — all changes land in existing capabilities._

### Modified Capabilities

- `tester-mode`: the tester system prompt forbids ending the turn to wait; a tester run that ends without `record_and_upload` or `report_status` is gated — one corrective resume, then a loud failure to the thread (never a silent Completed).
- `repo-setup-memory`: a gated tester run that never rewrote its setup entry gets the rewrite instruction included in the corrective resume, so learnings survive runs that die before their end-of-run rewrite.

## Impact

- `src/tester/prompt.ts` — new hard rule in `TESTER_SYSTEM_PROMPT`; a corrective-resume prompt builder.
- `src/changes/execution.ts` (`executeTest`) — deliverable tracking + single corrective resume via the existing `resumeSessionId` option + loud-failure path; `teardownAppProcess` must run only after the resume attempt (the app may still be needed to finish the recording).
- `src/tools/worker/` tester toolbelt (`record_and_upload`, `report_status`, `remember`) — call-tracking hook on the tester tool context (`WorkerToolContext` or the `buildClackTools` result), no behavior change to the tools themselves.
- Builds on the `harden-setup-memory-loop` change (landed in b4f2618: `remember` shrink warning, directive wording, `test_focus` steering, notes-injection logging, `loadSetupNotes` metadata) — same files, disjoint requirement surfaces; the salvage check reuses its `loadSetupNotes` metadata for the pre-run baseline.
- No config surface, no migration, no i18n (corrective prompt is Claude-facing English; the loud-failure Slack message reuses existing worker-failure delivery which is already localized).

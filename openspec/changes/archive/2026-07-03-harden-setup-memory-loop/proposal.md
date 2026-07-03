# Harden the repo-setup-memory loop

## Why

A live tester run (PR #4647 debug session) exposed four weaknesses in the setup-memory loop. The run's end-of-run memory rewrite took three `remember` calls in 42 seconds: the first two silently **replaced the 3,166-char setup recipe with a one-line summary** — a crash between those calls would have destroyed the learned recipe with no warning. Root cause: the `remember` schema describes `what` as "a one-line statement" while the injected REPO SETUP MEMORY directive requires `what` to be the full recipe body — the schema wins at call time. Separately, query-mode Claude recalled the `tester-setup` memory and baked its setup facts (ports, mock strategy, auth bypass) into `run_test`'s `test_focus`, which lands in an operator-authoritative prompt slot that outranks the tester's own "trust the repo over notes" self-correction — freezing potentially stale facts. Finally, notes injection is invisible: `execution.log` never says whether a run got learned notes or ran cold, which is exactly what made this incident hard to diagnose.

## What Changes

- **`remember` result echoes what was replaced**: `rememberCore` returns the previous entry alongside the saved one; the tool result gains `replaced: { previousWhatLength, newWhatLength }` when an existing entry's `what` was overwritten, plus a `warning` string on drastic shrink (previous `what` > 500 chars AND new `what` < 25% of it). Generic — no `*-setup:*` id special-casing, so the memory tool stays ignorant of the setup-memory naming convention.
- **Fix the `what` schema/directive contradiction**: the `remember` tool's `what` description no longer asserts "one-line statement" as universal — it allows living-document entries to store a full markdown body; the setup-memory directive (`buildSetupMemoryDirective`) explicitly reinforces that the recipe goes in `what` (not `nextSteps`/`why`) despite the schema's usual one-line convention.
- **`run_test` `test_focus` steers content, not setup**: the field description tells query-mode Claude to describe WHAT to exercise and include user-stated details from the conversation, but NOT to copy boot/setup knowledge from recalled memories — the tester receives learned setup notes directly through prompt injection.
- **Notes-injection observability**: both injection sites (worker at prompt assembly, tester at `executeTest`) log one line to the execution log — `injected (<N> chars, updated <ISO>)` or `cold run (no notes)` — requiring `loadSetupNotes` to return entry metadata (`{ notes, updatedAt }`) instead of a bare string.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `memory-faculty`: the `remember` tool's result shape gains replaced-entry feedback and a shrink warning; the `what` field description permits full-body living-document entries.
- `repo-setup-memory`: the record/verify/rewrite directive explicitly places the recipe in `what`; learned-notes injection becomes observable via execution-log lines; `loadSetupNotes` returns entry metadata.
- `tester-mode`: the `run_test` `test_focus` contract distinguishes user-stated details (include) from memory-recalled setup facts (exclude).

## Impact

- `src/memoryRegistry.ts` — `rememberCore` return type widens to include the previous entry (all callers are the tool + tests).
- `src/tools/query/remember.ts` — result payload gains `replaced`/`warning`; `what` description reworded.
- `src/memory/setupMemory.ts` — directive wording; `loadSetupNotes` return type widens (ripples into `src/tester/prompt.ts` `TesterPromptOptions.learnedNotes` and `src/changes/execution.ts` call sites).
- `src/tools/actions/runTest.ts` — `test_focus` description reworded (no behavior change).
- `src/changes/execution.ts` — two new execution-log lines (worker + tester injection sites).
- No config, migration, or i18n surface: all strings are Claude-facing (stay English per convention); result-shape additions are additive and backward-compatible.

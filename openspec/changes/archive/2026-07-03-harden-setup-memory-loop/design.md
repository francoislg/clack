# Design — harden-setup-memory-loop

## Context

The repo-setup-memory loop (spec `repo-setup-memory`) has three legs: the harness injects the learned `<kind>-setup:<repo>` entry into worker/tester system prompts (`loadSetupNotes` → `buildSetupMemoryPromptSections`), the run verifies notes against the repo, and the run rewrites the entry at the end via the generic `remember` tool. A production tester run showed the rewrite leg is fragile (two destructive one-line overwrites before the correct full-recipe rewrite) and the loop is unobservable (no log line says whether notes were injected). A fourth, adjacent issue: query-mode Claude launders recalled setup facts into `run_test.test_focus`, promoting advisory memory content into the operator-authoritative request description.

Constraints: `remember`/`recall` are generic memory tools used by many prompts (PR memory, idler ledger) — fixes must not couple them to setup-memory conventions. All touched strings are Claude-facing and stay English. Memory persistence is a graceful reader; no store shape change.

## Goals / Non-Goals

**Goals:**
- Make a destructive `what` overwrite immediately visible to the calling model (self-repair within one turn).
- Remove the schema-vs-directive contradiction that caused the fumble.
- Keep memory-recalled setup facts out of `test_focus`.
- Make notes injection observable in `execution.log` (presence, size, age).

**Non-Goals:**
- No hard rejection of shrinking writes — `remember` keeps replace semantics; the guard is feedback, not a gate (a legitimate rewrite can shrink an entry).
- No versioning/undo for memory entries.
- No change to when/whether runs rewrite the entry (directive-driven, end-of-run, skip-if-unchanged stays).
- No new config surface.

## Decisions

**D1 — Shrink feedback lives in the tool layer; `rememberCore` just exposes the previous entry.**
`rememberCore` currently discards `existing` after merging. It will return `{ entry, previous }` (previous `undefined` on first create). The `remember` tool computes `replaced: { previousWhatLength, newWhatLength }` (only when a previous entry existed AND `what` was explicitly provided — omitted `what` keeps the prior value and produces no `replaced` block) and a `warning` string when `previousWhatLength > 500 && newWhatLength < previousWhatLength / 4`.
*Why not `*-setup:*` id-scoping (the original suggestion)?* The generic threshold catches the same incident without teaching `tools/query/remember.ts` about `setupMemory`'s naming convention; one-line↔one-line updates never trip a >500-char floor. *Why not warn inside `rememberCore`?* Warning phrasing is a Claude-facing tool concern; the registry stays a pure store.

**D2 — Fix the contradiction at both ends, schema first.**
The `what` description becomes: "What this is — usually a one-line statement; living-document entries (e.g. setup recipes) store their full markdown body here." The setup-memory directive adds one reinforcing sentence: the recipe goes in `what` even though the schema's usual convention is one line; do not put the recipe in `why` or `nextSteps`. *Why both?* The schema is the stronger prime at call time (it's what caused the incident), but the directive is where the setup-specific rule belongs; each alone leaves one side ambiguous. A quick audit of other `remember`-referencing prompts (`user/memory.md`, idler fetch instructions) found none that depend on the "one-line" phrasing.

**D3 — `test_focus` steer distinguishes provenance, not content type.**
New description: describe WHAT to exercise; include details the USER stated in the conversation (the tester cannot see the thread); do NOT copy boot/setup knowledge from recalled memories — the tester receives learned setup notes directly. *Why provenance-based?* A blanket "no setup details" rule would drop legitimate user-stated instructions ("test against staging config X"), which must flow through. The hazard is specifically memory-sourced facts landing in an authoritative slot that outranks the tester's "trust the repo over notes" escape hatch.

**D4 — `loadSetupNotes` widens to `{ notes, updatedAt } | null`; call sites log one line.**
Return `null` for the cold-run path (missing entry, empty `what`, or store failure — unchanged semantics), else `{ notes: string, updatedAt: string }`. Worker site (prompt assembly in `execution.ts`) and tester site (`executeTest`) log `Setup notes: injected (<N> chars, updated <ISO>)` or `Setup notes: none (cold run)` through the existing per-session execution logger. `TesterPromptOptions.learnedNotes` stays `string | null` — the call site unwraps `.notes`, keeping the prompt builder untouched except for the doc comment. *Why updatedAt in the log?* Staleness is the more diagnostic half ("notes injected but 3 weeks old" explains a run that fought its notes).

## Risks / Trade-offs

- [False-positive shrink warnings on legitimate recipe simplifications] → The warning is advisory text in the tool result, not an error; the directive already tells the model corrections/removals matter. A model that intended the shrink proceeds; one that didn't (the incident) repairs.
- [Threshold constants (500 chars, 25%) are judgment calls] → Kept as named constants in `remember.ts`; not config — no operator has a reason to tune them, and config would need zod + docs for marginal value.
- [Widening `rememberCore`'s return type touches its callers] → Three callers: the `remember` tool, tests, and the plugin SDK (`src/plugins/sdkMemory.ts` — `sdk.memory.remember`). The SDK adapter unwraps `.entry` so `ClackSdkMemory.remember()` keeps returning `Promise<MemoryEntry>` and no plugin sees the shape change; plugin namespace writes go through `mergeMemoryNamespace`, untouched.
- [Longer tool result payloads on every overwrite] → `replaced` is two integers; negligible token cost, and only present when an entry was actually overwritten.

## Migration Plan

Pure code change; no data migration, no config. Deploys with the normal image update. Rollback = revert; the additive result fields and log lines have no persistence footprint.

## Open Questions

_None — thresholds and wording were settled during exploration._

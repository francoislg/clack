# Design — add-repo-setup-memory

## Context

Workers and testers rediscover repo setup on every run. The building blocks already exist:

- **Memory registry** (`src/memoryRegistry.ts`): keyed entries with replace-on-rewrite semantics (`rememberCore` re-using an id updates), `getMemory(id)` for direct lookup, `searchMemory` behind the `recall` tool. Entries with no `staleAfter.date` are never auto-pruned.
- **Toolbelts** (`src/tools/server.ts`): query mode gets `remember` + `recall`; `buildWorkerTools` and `buildTesterTools` get `remember` only — workers/testers are write-only against memory.
- **Prompts**: worker system prompt assembled in `src/changes/execution.ts` (~415–437, with an existing `remember`-tagging directive at ~345); tester system prompt in `src/tester/prompt.ts` (`buildTesterSystemPrompt`, currently sync, single-app-shaped WORKFLOW).
- **Editable file registry** (`src/repoInstructionFiles.ts`): drives the Home Tab editor, `list_config_files`, and `propose_config_update`. Contains `changes_instructions.md` + the two worktree files; the two tester files are read by the tester prompt but not registered.

Depends on `add-tester-worker-mode` (tester prompt/toolbelt/instruction files land there).

## Goals / Non-Goals

**Goals:**

- Workers and testers start every run with what previous runs learned about the repo's setup, deterministically.
- The learned entry converges to a clean current recipe (rewrite, not append) and self-heals against repo drift (docs-as-provenance).
- Tester runs handle monorepos: discover which services the diff needs, map prerequisites, boot the subset.
- The two tester instruction files join the admin-editable surface, enabling manual graduation of stabilized notes into blessed files.

**Non-Goals:**

- No auto-writing of instruction files (no feedback loop into the "execute EXACTLY and LITERALLY" setup executors).
- No new MCP tools, no memory-store schema changes, no new persistence.
- No changes to `runWorktreeSetup` / `runWorktreeInstall` or the pool's `setupVersion` hashing.
- No consolidation automation — folding notes into `test_instructions.md` stays a manual admin ask via `propose_config_update`.

## Decisions

### D1 — Injection over recall-first, with `recall` also in the toolbelt

Learned notes are fetched server-side at prompt-build time (`getMemory("worker-setup:<repo>")` / `getMemory("tester-setup:<repo>")`) and injected into the system prompt as a "NOTES FROM PREVIOUS RUNS" section. Rationale: the speed-up must not depend on Claude thinking to call a tool — injection is deterministic and costs zero tool round-trips. `createRecallTool()` is *also* added to both toolbelts as a general faculty (broader lookups: the other kind's entry, `worker:<branch>` tags, related notes).

*Alternative considered*: prompt directive "first, call `recall`". Rejected: per-run variance, one wasted round-trip, and the keyed lookup needs no search.

### D2 — One living entry per repo per run kind, replace semantics

Ids: `worker-setup:<repo>` and `tester-setup:<repo>`. Re-using the id replaces content, so the directive is **rewrite, don't append**: at end of run, if anything changed, `remember` the id again with the *current* full recipe. Corrections and removals matter as much as additions; the entry always reads as "the clean recipe as of today", never run archaeology. No `staleAfter.date` — setup knowledge must not be auto-pruned; drift is handled by D4. The prompt suggests cross-linking the sibling entry (`linkedMemories: [{ id: "tester-setup:<repo>", reason: "same repo, tester-run view" }]`).

*Alternative considered*: one entry per run (append-only log) + consolidation pass. Rejected: bloat, needs a consolidator, and replace semantics already exist.

### D3 — Memory shape by convention, not schema

The entry's `what` holds free-text markdown structured only by the prompt directive:

```markdown
## Services          (catalog: name → boot cmd, port, depends-on)
## Prerequisites     (env files, docker deps, build-first steps)
## Doc sources       (files these steps were derived from — re-check on failure)
## Quirks            (0.0.0.0 binding, slow first boot, seed ordering…)
```

`remember`/`memoryRegistry` are untouched. A malformed or free-form entry degrades gracefully (it's advisory prose either way).

### D4 — Docs as provenance: the self-healing rule

The directive stores both the recipe (fast path) and pointers to the repo docs it came from (README, CONTRIBUTING, docs/, workspace manifests). Verify-against-reality rule: notes describe the repo *as last seen*; when a step fails or conflicts with the repo, trust the repo — re-read the source docs, fix the recipe, rewrite the entry with updated steps *and* pointers. Pointers age slower than steps because docs usually change with the setup.

### D5 — Tester discovery phase: catalog is per-repo, subset is per-run

The tester WORKFLOW gains a discovery step before boot: (1) intersect the diff with the service catalog to pick *which* services this run needs, (2) map and set up prerequisites, (3) boot the subset. The memory holds the catalog (stable per-repo knowledge); the subset decision is re-derived every run from the diff — it must never be memorized. First run on a repo builds the catalog the hard way (from repo docs); later runs only re-derive the subset.

### D6 — Advisory layer under blessed files; graduation stays manual

Precedence in the prompt: operator-authored instruction files are authoritative; learned notes fill gaps and must yield on conflict. Adding `test_instructions.md` + `tester_data_setup_instructions.md` to `REPO_INSTRUCTION_FILES` (schema enum and listings derive automatically) opens the graduation path: an admin asks Clack to fold stabilized notes into the blessed file via the existing `propose_config_update` flow. No automation.

*Alternative considered*: auto-write learned steps into the instruction files. Rejected: those files are executed "EXACTLY and LITERALLY" by `runWorktreeSetup` — a bad learned step would be faithfully executed forever (feedback loop).

### D7 — Async prompt assembly

`buildTesterSystemPrompt` is sync today; `getMemory` is async. Either the function goes async or the caller (execution.ts ~597) fetches the entry and passes it in via `TesterPromptOptions`. Prefer passing it in: keeps prompt assembly pure/sync and trivially testable; the worker side does the same at its assembly site (~415). Lookup failures (missing entry, store error) inject nothing — a fresh-repo run is the normal cold path, never an error.

## Risks / Trade-offs

- [Poisoned/wrong learned note misleads future runs] → Notes are advisory prose, never literally executed; verify-against-reality directive says trust the repo on conflict; entries are visible via `recall`/query-mode memory tools and can be corrected or `forget`-ed by an admin ask.
- [Entry bloats or degrades over rewrites] → Replace semantics + "clean recipe as of today" directive; worst case the entry is prose noise, cost is a wasted prompt section, not behavior.
- [Concurrent runs on the same repo race on the entry] → `rememberCore` writes are serialized; last-writer-wins on a whole-entry rewrite is acceptable for advisory content (both writers derived from the same repo state).
- [Tester prompt grows further (discovery + notes + directives)] → The discovery phase replaces/absorbs today's single-app steps 2–3 rather than stacking on top; injection section only present when an entry exists.
- [Dependency on unarchived `add-tester-worker-mode`] → Sequence implementation after it; the worker-side half (recall in toolbelt, worker prompt injection) has no tester dependency if it must land first.

## Open Questions

- Should the injected notes section be capped (e.g. first N chars) to bound prompt growth if an entry balloons? Leaning no for v1 — the rewrite directive is the control.
- Should query mode's daily memory review get a hint to skip `*-setup:*` entries in staleness suggestions? They have no `staleAfter.date`, so default behavior already keeps them; revisit only if the review starts flagging them.

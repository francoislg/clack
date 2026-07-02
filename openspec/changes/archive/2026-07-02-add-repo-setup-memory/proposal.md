# Add Repo Setup Memory

## Why

Every worker and tester run rediscovers repo-specific setup knowledge from scratch — which services a monorepo needs, boot commands, ports, env prerequisites, seed quirks. The tester is hit hardest: it is the newest run kind, no repo has battle-tested `test_instructions.md` yet, and its first phase (boot the app) is exactly where discovery flounders. Meanwhile the pieces for a self-learning loop already exist — the `remember` tool is in both toolbelts and the memory registry supports keyed, updating entries — but workers and testers are write-only (no `recall`), nothing injects learned notes back into their prompts, and the two tester instruction files aren't even admin-editable.

## What Changes

- **`recall` joins the worker and tester toolbelts.** Both currently get `remember` only; a worker can't even read back its own `worker:<branch>` tag. One line each in `buildWorkerTools` / `buildTesterTools`.
- **Keyed setup memory per repo per run kind.** Convention: `worker-setup:<repo>` and `tester-setup:<repo>` — one living entry each, where re-using the id replaces content so the entry converges to "the clean recipe as of today" instead of accumulating run history.
- **Deterministic prompt injection.** `buildTesterSystemPrompt` and the worker prompt assembly look up the keyed entry server-side and inject it as advisory "notes from previous runs" — the speed-up never depends on Claude thinking to call `recall`.
- **Record/verify/rewrite directive** in both prompts: start from the notes, trust the repo over the notes when they conflict (repos evolve), and at end of run rewrite the entry with the *current* full recipe — corrections and removals matter as much as additions.
- **Tester discovery phase.** The tester WORKFLOW gains a discovery step ahead of boot: (1) intersect the diff with the repo's service catalog to decide *which* services this run needs (monorepo-aware), (2) map prerequisites (env, docker deps, build-first packages) and set them up, (3) boot. The memory entry holds the per-repo *catalog* (services, boot commands, ports, dependencies); the per-run diff decides the subset.
- **Docs as provenance.** The memory convention stores both the recipe (fast path) and pointers to the repo docs it was derived from (README, CONTRIBUTING, docs/) — when a recipe step fails, the directive says re-read the source docs, fix the recipe, and rewrite the memory with updated pointers. Pointers age slower than steps and make the recipe self-healing.
- **`test_instructions.md` and `tester_data_setup_instructions.md` become editable.** Both are read by the tester prompt today but missing from `REPO_INSTRUCTION_FILES`, so they're invisible to the Home Tab editor, `list_config_files`, and `propose_config_update`. Adding them closes the graduation path: stabilized learned notes can be folded into the blessed files via the normal admin-approval flow.

**Trust model (unchanged surfaces):** operator-authored instruction files stay authoritative and are never auto-written; memory is the advisory, self-maintained layer on top. No new tools, no new stores, no schema changes to the memory registry.

## Capabilities

### New Capabilities

- `repo-setup-memory`: The self-learning setup loop — keyed memory conventions (`worker-setup:<repo>` / `tester-setup:<repo>`), `recall` availability in worker and tester toolbelts, deterministic injection of learned notes into worker and tester prompts, the record/verify/rewrite directive, the tester discovery phase (service catalog → prerequisite mapping → boot), and the docs-as-provenance convention.

### Modified Capabilities

- `config-update-via-chat`: The centralized per-repo instruction file set (`REPO_INSTRUCTION_FILES`) gains `test_instructions.md` and `tester_data_setup_instructions.md`, making them visible to `list_config_files`, `read_config_file`, and `propose_config_update` (the schema enum and listings derive from the constant).

## Impact

- `src/tools/server.ts` — `createRecallTool()` added to `buildWorkerTools` and `buildTesterTools`.
- `src/repoInstructionFiles.ts` — two filenames added to `REPO_INSTRUCTION_FILES` (schema enum and `list_config_files` derive from it automatically).
- `src/tester/prompt.ts` — WORKFLOW rewritten with the discovery phase; learned-notes injection; record/verify/rewrite directive.
- `src/changes/execution.ts` — worker prompt assembly injects `worker-setup:<repo>` notes + directive.
- `src/memoryRegistry.ts` — read-only consumer (lookup by id at prompt-build time); no changes to the store or schemas.
- **Dependency:** builds on `add-tester-worker-mode` (in progress — tester prompt, toolbelt, and instruction files all land there). This change must be implemented/archived after it.
- Non-goals: no auto-writing of instruction files, no new MCP tools, no changes to `runWorktreeSetup`/`runWorktreeInstall` (the literal setup executors), no pool/`setupVersion` changes.

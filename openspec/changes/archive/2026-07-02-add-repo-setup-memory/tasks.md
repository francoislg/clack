# Tasks — add-repo-setup-memory

## 1. Recall in toolbelts

- [x] 1.1 Add `createRecallTool()` to `buildWorkerTools` in `src/tools/server.ts` (next to the existing `createRememberTool()`)
- [x] 1.2 Add `createRecallTool()` to `buildTesterTools` in `src/tools/server.ts`
- [x] 1.3 Update `src/tools/server.test.ts` toolbelt assertions: `recall` present in worker and tester tool lists

## 2. Editable registry

- [x] 2.1 Add `test_instructions.md` and `tester_data_setup_instructions.md` to `REPO_INSTRUCTION_FILES` in `src/repoInstructionFiles.ts`
- [x] 2.2 Update tests that assert the registry's exact contents (`src/configurationFiles.test.ts`, `src/tools/query/listConfigFiles.test.ts`, `src/tools/query/configFieldSchemas.test.ts`, `src/tools/actions/proposeConfigUpdate.test.ts`) to the five-file set
- [x] 2.3 Verify `list_config_files` / `read_config_file` / `propose_config_update` accept the two tester files with no further changes (enum derives from the constant)

## 3. Setup-memory lookup helper

- [x] 3.1 Add a small shared helper (`src/changes/setupMemory.ts`) that builds the keyed id (`worker-setup:<repo>` / `tester-setup:<repo>`), fetches it via `getMemory`, and returns the notes text or null — swallowing lookup errors (cold-run path, never throws)
- [x] 3.2 Unit-test the helper with `memoryRegistry` mocked: entry present → text, entry absent → null, `getMemory` throws → null

## 4. Worker prompt wiring

- [x] 4.1 In the worker prompt assembly (`src/changes/execution.ts` ~415), fetch `worker-setup:<repo>` via the helper and append a "NOTES FROM PREVIOUS RUNS (advisory)" section when present
- [x] 4.2 Add the record/verify/rewrite directive to the worker system prompt: start from notes, trust the repo on conflict (re-read the recorded doc sources to repair the recipe when a step fails, and update the pointers alongside the steps), rewrite the full recipe via `remember` at end of run if anything changed, cross-link the sibling `tester-setup:<repo>` entry, no `staleAfter.date`
- [x] 4.3 Add `src/changes/execution.setupNotes.test.ts` (own file — `execution.test.ts` is runClaude-scoped): prompt contains the notes section when memory has an entry; omits it when absent; existing prompt content unchanged

## 5. Tester prompt wiring

- [x] 5.1 Add an optional `learnedNotes` field to `TesterPromptOptions`; `buildTesterSystemPrompt` stays sync and injects the section when set; the caller in `src/changes/execution.ts` (~597) fetches it via the helper
- [x] 5.2 Rewrite the tester WORKFLOW's boot steps into the discovery phase: (1) intersect diff with the service catalog (from notes, else discover from repo docs/manifests) to pick required services + their dependencies, (2) map and set up prerequisites (env files, docker deps such as databases, build-first packages) for the selected services, (3) boot the subset — preserving the existing 0.0.0.0 / pid-file / health-check / seed contracts
- [x] 5.3 Add the memory directive to the tester prompt: notes shape convention (Services / Prerequisites / Doc sources / Quirks), docs-as-provenance repair rule, rewrite-don't-append, subset decision is per-run and never memorized, blessed instruction files win on conflict
- [x] 5.4 Extend `src/tester/prompt.test.ts`: notes injected when provided, omitted when null; discovery phase present; existing per-repo instruction sections unchanged

## 6. Verification

- [x] 6.1 `npx tsc` clean; `npm run test` green; `npx oxlint` / `npx oxfmt --check` on touched files
- [x] 6.2 Smoke the write → read-back → inject loop against the real (isolated) memory store: `rememberCore` a `tester-setup:<repo>` entry, `loadSetupNotes` reads it back, `buildTesterSystemPrompt` carries the notes section + directive; cold repo yields no section. (Live Slack-triggered worker/tester runs aren't reachable pre-deploy — observe the first real runs' execution logs after deploy.)

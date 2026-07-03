# Tasks — harden-setup-memory-loop

## 1. Replaced-entry feedback on remember

- [x] 1.1 Widen `rememberCore` (`src/memoryRegistry.ts`) to return `{ entry, previous }` (previous `undefined` on first create); update its unit tests
- [x] 1.1b Adapt `src/plugins/sdkMemory.ts` — unwrap `.entry` from the widened result so `ClackSdkMemory.remember()` keeps its `Promise<MemoryEntry>` contract (plugins unaffected); update its tests if any assert the passthrough
- [x] 1.2 In `createRememberTool` (`src/tools/query/remember.ts`), compute `replaced: { previousWhatLength, newWhatLength }` when a prior entry existed and `what` was provided; add named threshold constants (`SHRINK_WARNING_MIN_PREVIOUS_CHARS = 500`, `SHRINK_WARNING_RATIO = 0.25`) and emit the `warning` string on drastic shrink
- [x] 1.3 Unit tests for the tool result: overwrite echoes lengths, drastic shrink warns, sub-500-char previous never warns, first create / omitted `what` produce no `replaced` or `warning`

## 2. what schema/directive contradiction

- [x] 2.1 Reword the `what` argument description in `src/tools/query/remember.ts` — usual one-line convention, full markdown body permitted for living-document entries
- [x] 2.2 Add the reinforcing sentence to `buildSetupMemoryDirective` (`src/memory/setupMemory.ts`): recipe goes in `what`, never in/split across `why` or `nextSteps`
- [x] 2.3 Update `setupMemory` unit tests asserting the directive text includes the new sentence

## 3. run_test test_focus provenance steer

- [x] 3.1 Reword the `test_focus` description in `src/tools/actions/runTest.ts`: describe WHAT to exercise, include user-stated details, do NOT copy setup facts from recalled memories (tester gets notes via injection)
- [x] 3.2 Adjust `runTest` unit tests if any assert the description text

## 4. Notes-injection observability

- [x] 4.1 Widen `loadSetupNotes` (`src/memory/setupMemory.ts`) to return `{ notes, updatedAt } | null`; keep null semantics for missing/empty/failed lookups; update its unit tests
- [x] 4.2 Update the worker call site (`src/changes/execution.ts` prompt assembly) — unwrap `.notes`, log `Setup notes: injected (<N> chars, updated <ISO>)` or `Setup notes: none (cold run)` via the run's execution logger
- [x] 4.3 Update the tester call site (`executeTest` in `src/changes/execution.ts`) the same way; `TesterPromptOptions.learnedNotes` stays `string | null` — update its doc comment in `src/tester/prompt.ts` to note unwrapping happens at the call site
- [x] 4.4 Tests covering both log lines (injected with length+timestamp, cold run) at both call sites

## 5. Verification

- [x] 5.1 `npx tsc`, `npm run test`, `npx oxlint` / `npx oxfmt` on touched files
- [x] 5.2 `openspec validate harden-setup-memory-loop --strict`

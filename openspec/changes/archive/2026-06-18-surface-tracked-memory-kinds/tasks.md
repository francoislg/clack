## 1. Open the memory faculty to everyone

- [x] 1.1 Widen `canAccessMemory` in `src/permissions.ts` from `dev` to `member`
- [x] 1.2 Update the gating comment in `src/tools/server.ts` to reflect all-roles access
- [x] 1.3 Add/adjust a test asserting `canAccessMemory` returns true for `member`

## 2. Derive tracked kinds from the store

- [x] 2.1 Create `src/memory/trackedKinds.ts` with `namespaceOf(id)`, `listTrackedKinds()`, and `buildTrackedMemoryKinds()`
- [x] 2.2 Add `src/memory/trackedKinds.test.ts` covering: distinct sorted/de-duped namespaces, colon-less ids excluded, empty store → empty string, single-namespace store

## 3. Inject the block into the system prompt

- [x] 3.1 Add `trackedMemoryKinds?: string` to `PromptOptions` in `src/claude/promptBuilder.ts` and append it to the assembled prompt when non-empty
- [x] 3.2 In `buildQuerySetup` (`src/claude/index.ts`), compute the block via `buildTrackedMemoryKinds()` and pass it into `buildSystemPrompt`
- [x] 3.3 Add a promptBuilder test asserting the block is included when provided and omitted when empty/absent

## 4. Baseline recall instruction

- [x] 4.1 Add `data/default_configuration/user/memory.md` directing recall-before-continue and honoring `nextSteps`

## 5. Verify

- [x] 5.1 `npx tsc` clean
- [x] 5.2 `npx oxlint` + `npx oxfmt --check` clean on changed files
- [x] 5.3 `npm test` green

## 1. Add workMode to the processMessage pipeline

- [x] 1.1 Add `workMode?: boolean` to `ProcessMessageParams` in `src/slack/handlers/core.ts`
- [x] 1.2 Add `workMode?: boolean` to `AskClaudeOptions` in `src/claude.ts`
- [x] 1.3 Thread `workMode` from `ProcessingContext` through to `askClaude()` call in `processMessage()`
- [x] 1.4 In `askClaude()`, when `workMode` is true, prepend the work-mode hint to the user prompt (before the QUESTION line in `buildPrompt`)

## 2. Unify reaction handler routing

- [x] 2.1 In `registerNewQueryHandler` (`src/slack/handlers/newQuery.ts`), replace the `isChangeTrigger` branch: for dev+ users call `processMessage({ workMode: true })`, for non-dev users call `processMessage()` (standard Q&A fallback)
- [x] 2.2 Remove the `handleChangeReaction` function entirely from `newQuery.ts`
- [x] 2.3 Remove now-unused imports from `newQuery.ts`: `generateChangePlan`, `startChangeWorkflow`, `ChangeRequest`, `getChangeEnabledRepos`, `isDev`, `getRole`

## 3. Remove legacy plan generation code

- [x] 3.1 Remove `generateChangePlan()` function from `src/changes/execution.ts`
- [x] 3.2 Remove `PLAN_GENERATION_PROMPT` constant from `src/changes/execution.ts`
- [x] 3.3 Remove `PlanGenerationResult` type from `src/changes/types.ts`
- [x] 3.4 Remove the `generateChangePlan` export from `execution.ts` (verify no other imports remain)

## 4. Verify and test

- [x] 4.1 Run TypeScript compilation (`npm run build`) to confirm no broken imports or type errors
- [x] 4.2 Run tests if available (`npm test`) to confirm no regressions

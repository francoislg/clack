## 1. Config & Type Changes

- [x] 1.1 Remove `pullRequestInstructions` from `RepositoryConfig` in `src/config.ts` and its parsing logic
- [x] 1.2 Remove `prInstructions` from `ChangesWorkflowConfig` in `src/config.ts` and its parsing logic
- [x] 1.3 Remove `pullRequestInstructions` from `data/config.json` repo entry

## 2. Dynamic Instruction File List

- [x] 2.1 Update `src/configurationFiles.ts`: make `listInstructionFiles()` dynamic — static role files + generated `{repo.name}_changes_instructions.md` and `{repo.name}_worktree_setup_instructions.md` per configured repository
- [x] 2.2 Update `src/configurationFiles.ts`: handle "create new" case where neither override nor default exists (file shows in list but needs creation)

## 3. Changes Instructions in Execution

- [x] 3.1 Remove `resolvePRInstructions()` from `src/changes/execution.ts`
- [x] 3.2 Update `executeChange()` to resolve `{repo}_changes_instructions.md` via `resolveInstructionFile()` and append to execution system prompt
- [x] 3.3 Remove the `prInstructions` parameter from `executeChange()` signature
- [x] 3.4 Update `src/changes/workflow.ts` to stop calling `resolvePRInstructions()` and stop passing `prInstructions` to `executeChange()`
- [x] 3.5 Update `src/changes/pr.ts` to resolve changes instructions via `resolveInstructionFile()` for PR body generation
- [x] 3.6 Update follow-up command execution in `src/changes/workflow.ts` to include changes instructions

## 4. Worktree Setup Step

- [x] 4.1 Add `runWorktreeSetup()` function in `src/changes/execution.ts` — runs Claude with setup instructions as prompt, Bash/Write/Edit/Read tools, configurable timeout (default 2 min), cwd = worktree path
- [x] 4.2 Call `runWorktreeSetup()` in `src/changes/workflow.ts` after `createWorktree()` for fresh worktrees only (not on resume)

## 5. Admin UI Support

- [x] 5.1 Update `src/slack/homeTab.ts` `buildConfigurationSection()` to handle files that don't exist in either tier (show "Create" button)
- [x] 5.2 Update `src/slack/handlers/homeTab.ts` edit handler to support creating new files (empty content when file doesn't exist)
- [x] 5.3 Fix `buildEditFileModal()` to truncate filename in modal title to 24 characters (Slack limit) — repo instruction filenames exceed this

## 6. Verification

- [x] 6.1 Run `npm run build` to verify no type errors
- [x] 6.2 Verify admin Home Tab renders correctly with repo instruction files listed

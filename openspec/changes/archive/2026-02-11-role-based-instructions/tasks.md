## 1. Directory Rename & Structure

- [x] 1.1 Rename `data/templates/` to `data/default_configuration/` (move `default_instructions.md` → `instructions.md`)
- [x] 1.2 Update `.gitignore`: replace `templates` references with `default_configuration`, add `data/configuration/` to gitignore
- [x] 1.3 Update `Dockerfile`: replace `COPY data/templates/` with `COPY data/default_configuration/`, create `data/configuration/` directory
- [x] 1.4 Update `data/config.example.json`: remove `claudeCode.systemPromptFile`

## 2. Create Role-Specific Default Files

- [x] 2.1 Create `data/default_configuration/dev_instructions.md` — extract the hardcoded "Change Request Detection" block from `buildSystemPrompt()` into this file, using `{CHANGE_REPOS_LIST}` and `{RESUMABLE_SESSIONS}` variables
- [x] 2.2 Create `data/default_configuration/user_instructions.md` — extract the hardcoded "Critical: Information Only" block into this file
- [x] 2.3 Rename `data/default_configuration/default_instructions.md` to `data/default_configuration/instructions.md` — update content to remove role-specific sections (they're now in separate files)

## 3. Instruction Resolution Module

- [x] 3.1 Create `src/instructions.ts` — module with: `resolveInstructionFile(filename)` that checks `data/configuration/{file}` then `data/default_configuration/{file}`; `loadInstructions(role, options)` that loads base + role file and concatenates; `interpolateVariables(content, variables)` for variable replacement
- [x] 3.2 Add `getConfigurationDir()` and `getDefaultConfigurationDir()` helpers to `src/config.ts`

## 4. Rewrite System Prompt Building

- [x] 4.1 Remove `claudeCode.systemPromptFile` from `ClaudeCodeConfig` interface and `DEFAULTS` in `src/config.ts`
- [x] 4.2 Remove `loadInstructionsTemplate()` from `src/claude.ts`
- [x] 4.3 Rewrite `buildSystemPrompt()` in `src/claude.ts` to use `loadInstructions()` from `src/instructions.ts` — pass user role and changesWorkflow state, remove all hardcoded prompt blocks
- [x] 4.4 Add role parameter to `AskClaudeOptions` or `buildSystemPrompt()` so it knows which role file to load

## 5. Startup & Migration

- [x] 5.1 Add deprecation check in `src/index.ts` startup: if `claudeCode.systemPromptFile` is present in config, log a warning with migration instructions
- [x] 5.2 Validate that `instructions.md` can be resolved on startup (error if not found in either tier)

## 6. Update References

- [x] 6.1 Update `scripts/docker-setup.sh` — replace any `templates/` references with `default_configuration/`
- [x] 6.2 Update `scripts/gce-deploy.sh` — replace any `templates/` references
- [x] 6.3 Update `README.md` — update architecture diagram and any references to `templates/` or `systemPromptFile`

## 7. Validation

- [x] 7.1 Verify the app builds successfully
- [x] 7.2 Verify the instruction files load correctly with variable interpolation

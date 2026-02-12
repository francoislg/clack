## 1. Registry Module

- [x] 1.1 Create `src/instructionVariables.ts` with `VariableDefinition` type and registry array containing all current variables: `REPOSITORIES_LIST`, `BOT_NAME`, `MCP_INTEGRATIONS`, `CHANGE_REQUEST_BLOCK`, `RESUMABLE_SESSIONS`
- [x] 1.2 Add `buildAvailableVariablesTable()` function that generates a markdown table from registry entries (excluding `AVAILABLE_VARIABLES` itself)
- [x] 1.3 Add `AVAILABLE_VARIABLES` to the registry with availability `"dev-admin"`

## 2. Integrate with buildSystemPrompt

- [x] 2.1 Import registry in `claude.ts` and add `AVAILABLE_VARIABLES` variable to the variables record using `buildAvailableVariablesTable()`
- [x] 2.2 Add validation: warn if any registry-defined variable is missing from the variables record

## 3. Update Admin Instructions

- [x] 3.1 Replace the hardcoded variable table in `admin_instructions.md` with `{AVAILABLE_VARIABLES}`

## 4. Build & Verify

- [x] 4.1 Build the project and verify no errors
- [x] 4.2 Verify that `AVAILABLE_VARIABLES` produces the expected markdown table output

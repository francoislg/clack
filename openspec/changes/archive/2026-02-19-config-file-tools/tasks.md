## 1. Add read_config_file Tool

- [x] 1.1 Create `src/tools/query/readConfigFile.ts` — new MCP tool that reads an instruction file via `readInstructionFile()` and returns content + metadata (hasOverride, hasDefault)
- [x] 1.2 Register `read_config_file` in the admin block in `src/tools/server.ts` alongside `list_config_files`

## 2. Modify propose_config_update Tool

- [x] 2.1 Add `operation` parameter (`"append" | "replace"`, default `"append"`) to `src/tools/actions/proposeConfigUpdate.ts`
- [x] 2.2 Implement append logic: read current content via `readInstructionFile()`, concatenate with new content, stage the combined result
- [x] 2.3 Remove the existing first-override seeding logic (lines 38-44) — append handles this naturally
- [x] 2.4 Keep replace logic as direct pass-through of provided content (current behavior)

## 3. Update Admin Instructions

- [x] 3.1 Update `data/default_configuration/admin_instructions.md` to describe read-then-edit workflow and append-by-default behavior

## 4. Update Specs

- [x] 4.1 Sync delta specs to main specs

## 5. Verify

- [x] 5.1 Run `npx tsc --noEmit` to confirm no type errors

## 1. Schema Update

- [x] 1.1 Add `auto` field to `configUpdateActionSchema` in `src/tools/presentation/submitResponse.ts` — add `auto: z.boolean().optional().describe(...)` matching the pattern of other ref-based actions

## 2. Auto-Execute Handler

- [x] 2.1 Handle `config_update` intent in `src/slack/handlers/autoExecute.ts` — when `action.type === "config_update"` and `intent.type === "config_update"`, call `writeInstructionFile(intent.file, intent.content)` and post a confirmation message in the thread
- [x] 2.2 Add error handling for the config write — catch errors from `writeInstructionFile()` and post error message in thread (matching existing auto-execute error pattern)

## 3. Default Instructions Update

- [x] 3.1 Add `### Auto-execute` section to `data/default_configuration/admin_instructions.md` — copy the pattern from `dev_instructions.md` but include `config_update` in the action list alongside `change`, `update`, `review`, `merge`, `close`
- [x] 3.2 Add `config_update` to the auto-execute action list in `data/default_configuration/dev_instructions.md` (line 16: add `config_update` to the parenthetical list)

## 4. Migration

- [x] 4.1 Create `src/migrations/003-auto-execute-instructions.ts` — migration that patches `data/configuration/admin_instructions.md` (add `### Auto-execute` section if missing) and `data/configuration/dev_instructions.md` (add `config_update` to auto-execute list). Skip files that don't exist as overrides.
- [x] 4.2 Register migration in `src/migrations/index.ts`

## Why

The `config_update` action is the only ref-based action that does not support `auto: true`. This means config updates always require a button click, even when the user gives a clear directive ("update the config to add X"). Claude ends up saying "I've added..." while still showing an "Apply Update" button — the user doesn't know whether the action happened or whether the button is needed.

Additionally, `admin_instructions.md` is missing the auto-execute guidance section entirely. Since admin/owner users load `admin_instructions.md` instead of `dev_instructions.md`, they never see the `auto: true` guidance — so Claude never auto-executes ANY action for admins, not just config updates. This explains reports of clear directives like "rebase the branch and force push" still rendering buttons instead of executing.

## What Changes

- Add `auto` boolean field to the `config_update` action schema in `submit_response`
- Handle `config_update` intents in the auto-execute handler (write the file directly via `writeInstructionFile()`)
- Add auto-execute guidance section to `admin_instructions.md` (currently missing entirely), including `config_update` in the list
- Add `config_update` to the auto-execute list in `dev_instructions.md`
- Add a migration (version 3) to patch custom instruction overrides in `data/configuration/`

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `auto-execute-actions`: Remove the "auto flag not available on config_update" exception; add config_update to the auto-execute supported set
- `clack-tool-response`: Update config_update action scenario to include optional `auto` field
- `config-update-via-chat`: Add auto-execute scenario for config updates

## Impact

- `src/tools/presentation/submitResponse.ts` — add `auto` to `configUpdateActionSchema`
- `src/slack/handlers/autoExecute.ts` — handle `config_update` intent type
- `data/default_configuration/admin_instructions.md` — add auto-execute guidance section (currently missing)
- `data/default_configuration/dev_instructions.md` — add `config_update` to auto-execute list
- `src/migrations/003-auto-execute-instructions.ts` — migration for custom overrides
- `src/migrations/index.ts` — register migration

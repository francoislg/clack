## Why

Instruction variables (like `{REPOSITORIES_LIST}`, `{CHANGE_REQUEST_BLOCK}`) are currently defined ad-hoc across two files — hardcoded in `buildSystemPrompt()` in `claude.ts` and manually documented in `admin_instructions.md`. Adding a new variable means updating code, the admin docs, and the Home Tab (planned). There's no single source of truth for what variables exist, what they do, or when they're available.

## What Changes

- Create a centralized variable definitions registry in `src/instructionVariables.ts` — each variable declares its name, description, and availability (always vs dev/admin only)
- Use the registry to auto-generate the `{AVAILABLE_VARIABLES}` meta-variable that replaces the hardcoded table in `admin_instructions.md`
- Export the registry for use by the Home Tab admin UI (showing available variables when editing instruction files)
- Refactor `buildSystemPrompt()` to build variables from the registry definitions

## Capabilities

### New Capabilities
- `instruction-variables`: Centralized registry of instruction template variables with metadata (name, description, availability)

### Modified Capabilities
- `instruction-system`: Add `AVAILABLE_VARIABLES` meta-variable requirement; variable definitions sourced from registry

## Impact

- **Code**: New `src/instructionVariables.ts` module; refactor variable building in `src/claude.ts`; update `admin_instructions.md` to use `{AVAILABLE_VARIABLES}` instead of hardcoded table
- **Admin UX**: Variable documentation auto-generated from registry — always in sync
- **Home Tab**: Registry exported for future use by `admin-edit-instructions` change (show variables when editing)

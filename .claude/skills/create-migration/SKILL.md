---
name: create-migration
description: Scaffold a new Clack migration file. Use when you need to create a migration for config changes, data format updates, or other upgrade tasks.
---

Create a new migration for Clack's boot migration system.

**Input**: The argument after `/create-migration` describes what the migration should do (e.g., "rename config field X to Y", "add new required config field").

**Steps**

1. **If no input provided, ask what the migration should do**

   Use the **AskUserQuestion tool** to ask:
   > "What should this migration do? Describe the change needed."

2. **Read existing migrations to determine next version**

   Read `src/migrations/index.ts` to see which migrations are registered.
   If migrations exist, read them to find the highest version number.
   The new migration version = highest existing version + 1, or 1 if none exist.

3. **Determine priority**

   Use the **AskUserQuestion tool** to ask:
   > "Is this migration blocking or enhancement?"

   Options:
   - **Blocking**: Must complete before Clack starts (e.g., breaking config changes)
   - **Enhancement**: Can run in background after boot (e.g., optional improvements)

4. **Determine file scope**

   Based on what the migration does, identify which files it needs read/write access to.
   Common files:
   - `data/config.json` — for config schema changes
   - `data/state/roles.json` — for role data changes
   - `data/state/version.json` — rarely needed directly

5. **Create the migration file**

   Create `src/migrations/NNN-<kebab-name>.ts` where NNN is the zero-padded version:

   ```typescript
   import type { Migration } from "./types.js";

   export const migration: Migration = {
     version: <next-version>,
     name: "<human-readable name>",
     priority: "<blocking|enhancement>",
     prompt: `<detailed prompt for Claude to execute the migration>`,
     files: [<list of files>],
   };
   ```

   The prompt should be specific and actionable:
   - Describe exactly what to change
   - Include the expected before/after state
   - Handle edge cases (field doesn't exist, already migrated, etc.)

6. **Register in barrel export**

   Update `src/migrations/index.ts` to import and include the new migration:

   ```typescript
   import { migration as mN } from "./NNN-<name>.js";
   // Add to the migrations array
   ```

7. **Create test file**

   Create `scripts/migration-tests/NNN.ts` with test cases for the new migration:

   ```typescript
   import type { MigrationTest } from "./types.js";

   export const test: MigrationTest = {
     version: <version>,
     cases: [
       {
         name: "<describe what this case tests>",
         input: { /* config in the OLD format (before migration) */ },
         validate: (output) => {
           // Return null if passed, error string if failed
           // Check that the migration transformed the config correctly
           return null;
         },
       },
       // Always include an "already migrated / no-op" case
     ],
   };
   ```

   Test case guidelines:
   - Cover each transformation the migration performs (one case per variant)
   - Include an "already migrated" case that verifies no-op behavior
   - Include a mixed case if the migration handles multiple items (e.g., repos array)
   - Validation should check both positive (new fields exist) and negative (old fields removed)

8. **Register test in runner**

   Update `scripts/migration-tests/run.ts`:
   - Add import: `import { test as testNNN } from "./NNN.js";`
   - Add to `allTests` array: `const allTests: MigrationTest[] = [..., testNNN];`

9. **Update the full-path test**

   In `scripts/migration-tests/run.ts`:
   - Update `VERSION_0_CONFIG` if needed (it should represent the oldest supported format)
   - Update `validateFinalState()` to verify the output after ALL migrations including the new one

10. **Run the tests**

    ```bash
    npx tsx scripts/migration-tests/run.ts
    ```

    Verify all individual tests and the full-path test pass.

11. **Show summary**

    Display:
    - Migration file path
    - Test file path
    - Version number
    - Priority
    - File scope
    - Number of test cases
    - Prompt preview

**Guardrails**
- Migrations MUST be idempotent — running twice should be safe
- The prompt should handle "already migrated" cases gracefully
- Version numbers must be sequential with no gaps
- File scope should be minimal — only list files the migration actually needs

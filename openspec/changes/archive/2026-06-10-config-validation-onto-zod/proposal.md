## Why

The main runtime config validators are fully hand-rolled and fail-fast (throw at boot). `src/config.ts` `validateConfig` is ~600 lines of manual `typeof` checks + private `section/str/bool/num/strArray` helpers + a dozen `parse*` sub-functions, validating 30+ nested fields. `src/mcpPinned.ts` does manual partial-pin checks that throw, and `src/tools/admin/allowlist.ts` `validateContent` re-validates config/mcp/tool-mapping files by hand. The rules are implicit in imperative code, defaults are filled with scattered `??`, and there is no shared error formatter.

This is **Change 2 of the sequenced "config validation onto zod" sweep**. It depends only on `src/plugins/zodResult.ts` (the shared leaf born in `collapse-trivia-config-validation-onto-zod`). These are the fail-fast surfaces — distinct in philosophy from the graceful persisted-state loaders (Change 3).

## What Changes

- Express `config.json` as zod schemas (one per config section), with `.default()` replacing the manual default-merge and `.refine()` for cross-field constraints (hex color, integer ranges, `maxAdditionalMessages` ∈ [1,10], suggestedPrompts ≤ 4, role enums, DM-type enum).
- `validateConfig` becomes a `schema.safeParse()` that throws a formatted error on failure (preserving fail-fast boot behavior and the existing error wording where tests/users depend on it), reusing `zodErrorToResult` from `src/zodResult.ts`.
- Migrate `mcpPinned.ts` partial-pin validation and `allowlist.ts` `validateMcpJson` onto zod schemas — preserving the partial-pin throw and the `ValidationResult` envelope.
- Retire the private `section/str/bool/num/strArray` helpers and the `parse*` sub-functions once the schema covers them.

`streaming/toolMappingLoader.ts` was considered (its blind `as ToolMappingConfig` cast) but **deferred**: tightening `tool_mapping/*.json` validation risks rejecting a real on-disk mapping (silently dropping task-card labels in production) for low value. It remains a documented candidate in `zod-inventory.md`.

## Capabilities

### Modified Capabilities

- `admin-config-tools` (config-file validation), `pinned-mcp-installs` (stdio partial-pin validation): validation is schema-driven; observable accept/reject behavior preserved.

## Impact

- Code: `src/config.ts`, `src/configSchemas.ts`, `src/configZod.ts`, `src/mcpPinned.ts`, `src/tools/admin/allowlist.ts`.
- Risk: largest single surface; behavior-preservation (same inputs throw/accept). Boot-time fail-fast must be retained — a malformed config must still abort startup, not degrade.
- Depends on: `collapse-trivia-config-validation-onto-zod` (REUSES the shared `src/plugins/zodResult.ts` leaf it introduces — bot core imports the same module, no duplicate helper). Stub proposal — `design`/`tasks` to be written once Change 1 lands.

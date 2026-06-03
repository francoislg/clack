## ADDED Requirements

### Requirement: Roles state loading is schema-driven

`roles.ts` SHALL parse `roles.json` against a zod schema (`owner: string | null`, `admins: string[]`, `devs: string[]`, each defaulted) instead of `JSON.parse` + manual `?? DEFAULTS`. On parse failure or missing file it SHALL return `DEFAULT_ROLES` (log + fallback, never throw), and partial/legacy files SHALL fill the same defaults as today.

#### Scenario: Missing or corrupt roles file falls back to defaults

- **WHEN** `roles.json` is absent or fails the schema
- **THEN** `loadRoles` returns `DEFAULT_ROLES`, exactly as today

#### Scenario: Partial roles file is defaulted identically

- **WHEN** `roles.json` omits a field (e.g. no `devs`)
- **THEN** the missing field is filled with its default (`[]` / `null`) matching the pre-migration result

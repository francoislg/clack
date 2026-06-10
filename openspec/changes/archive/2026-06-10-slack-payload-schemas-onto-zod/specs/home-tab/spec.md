## ADDED Requirements

### Requirement: Home Tab modal payloads are schema-driven

Home Tab modal submissions SHALL validate their `private_metadata` and `view.state.values` reads against zod schemas rather than blind `as` casts (`homeTab.ts`) or manual `typeof` guards (`userSkillsHomeActions.ts` `parseSlugMetadata` / `readInputValue` / `readCheckboxChecked`), preserving each call site's current behavior: a flow that errors on bad metadata today still errors; a helper that returns `null`/`false` on a missing field still returns `null`/`false`.

#### Scenario: Config-file modal metadata is validated

- **WHEN** a Home Tab config-file modal is submitted with `private_metadata` encoding `{ dir, filename }` (or `{ dir }`)
- **THEN** the handler reads the fields via a schema and proceeds exactly as today; a malformed `private_metadata` hits the same error path it does now

#### Scenario: User-skill modal reads degrade gracefully

- **WHEN** `parseSlugMetadata` / `readInputValue` / `readCheckboxChecked` read a modal payload that is missing or wrong-shaped
- **THEN** they return `null`/`false` exactly as today, now via `safeParse` instead of manual guards

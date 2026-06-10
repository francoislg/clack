## 1. Characterization gate (write first)

- [x] 1.1 Add `src/config.validation.characterization.test.ts` (vitest) snapshotting `validateConfig`: a table of valid inputs → resulting `Config` (incl. every default), and each rejection mode → exact thrown message (slack auth prefixes, repo access thresholds, role enum, DM-type enum, hex color, integer ranges, `maxAdditionalMessages ∈ [1,10]`, `assistant.suggestedPrompts ≤ 4`, cron legacy migration)
- [x] 1.2 Add characterization cases for `mcpPinned.parseStdioEntry` (partial-pin throw, valid pinned, legacy) and `allowlist.validateContent` (config.json / mcp.json)
- [x] 1.3 Run against current code; confirm green (captures the contract)

## 2. Section schemas (build alongside, no removals yet)

- [x] 2.1 Add `src/configZod.ts` reusing `Result`/`zodErrorToResult` from `src/plugins/zodResult.ts`; define a `safeParseOrThrow(schema, raw, label)` helper that throws `Error(zodErrorToResult(...).error)` on failure
- [x] 2.2 Schemas for the leaf sections with `.default()` matching today's `?? DEFAULTS`: `reactions`, `directMessages`, `mentions`, `autoRespond`, `taskCards`, `git`, `sessions`, `claudeCode`, `submitResponse` (range `[1,10]`), `assistant` (`suggestedPrompts ≤ 4`), `language`, `thinking`
- [x] 2.3 Schemas for the structured sections: `repositories[]` (incl. `access` thresholds, `mergeStrategy` enum, role enums), `changesWorkflow` (+ `reusableFolders`), `cron` (incl. legacy-form migration), `mcpServers`, `skillPlugins`, `userSkills`, `plugins`
- [x] 2.4 Compose the root `configZod`; add schema-level unit tests asserting parity with the characterization accept/reject table (defaults + messages via `zodErrorToResult`)

## 3. Cut over validateConfig

- [x] 3.1 Reimplement `validateConfig(config, slackAuth)` as `configZod.safeParse(merge(config, slackAuth))` → throw formatted error on failure, return `parsed.data` on success
- [x] 3.2 Re-run the characterization gate; confirm boot/throw parity + default parity byte-for-byte (BEFORE deleting old code, so a parity failure is easy to localize/revert)
- [x] 3.3 Once parity is confirmed and they are unreferenced, remove the now-dead extractor helpers (`section`/`str`/`bool`/`num`/`strArray`) and the `parse*` sub-functions

## 4. MCP + allowlist

- [x] 4.1 Migrate `mcpPinned.parseStdioEntry` to a zod schema preserving the partial-pin throw + discriminated result
- [x] 4.2 Migrate `allowlist.validateMcpJson` to the mcp schema; confirm `validateConfigJson` still delegates to the (now schema-backed) `validateConfig`; preserve the `ValidationResult` envelope

## 5. Green gate

- [x] 5.1 `npx tsc` clean
- [x] 5.2 `npx oxlint` + `npx oxfmt` clean on changed files
- [x] 5.3 `npm test` (vitest) green — characterization gate + existing config tests
- [ ] 5.4 `graphify update .` (coordinate timing with concurrent sessions before staging `graphify-out/`)

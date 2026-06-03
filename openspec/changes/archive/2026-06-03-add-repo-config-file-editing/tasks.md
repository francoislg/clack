## 1. Centralized repo-file constant

- [x] 1.1 Define `REPO_INSTRUCTION_FILES` (`as const`), `RepoInstructionFile` type, and `REPO_FILE_ENUM = z.enum(...)` as the single source of truth (placed in a neutral leaf module `src/repoInstructionFiles.ts` to avoid `configurationFiles.ts` → `tools/query/` import inversion)
- [x] 1.2 Refactor `getRepoEntries()` in `src/configurationFiles.ts` to iterate `REPO_INSTRUCTION_FILES` instead of its inline array (this surfaces the third file in `list_config_files`)

## 2. Schema: role XOR repo addressing

- [x] 2.1 In `configFieldSchemas.ts`, add `CONFIG_TARGET_FIELDS` (optional `role`, optional `repo`, optional `topic`, `file` as `FILE_PATTERN`) and `refineConfigTarget` enforcing exactly-one-of role/repo, `topic` forbidden in repo mode, repo-mode `file` ∈ `REPO_FILE_ENUM`
- [x] 2.2 Add `buildConfigPath(args)` (repo → `{repo}/{file}`, role → `buildInstructionPath`) and `validateConfigTarget` (handler-side cross-field check, since `tool()` takes a raw shape)
- [x] 2.3 Add `getConfiguredRepoNames()` in `configurationFiles.ts` for repo-existence validation

## 3. Wire tools

- [x] 3.1 `src/tools/query/readConfigFile.ts` — repo branch: `validateConfigTarget`, unknown-repo error, resolve via `buildConfigPath`; description documents repo mode
- [x] 3.2 `src/tools/actions/proposeConfigUpdate.ts` — repo branch: `validateConfigTarget`, unknown-repo error (no intent), resolve via `buildConfigPath`, reuse append/replace/delete staging; description documents repo mode
- [x] 3.3 Confirmed `readInstructionFile`/`writeInstructionFile` resolve `{repo}/{file}`; added a focused repo-path read test
- [x] 3.4 Documented repo mode in `data/default_configuration/admin/config-updates.md`

## 4. Tests

- [x] 4.1 `configFieldSchemas` tests: XOR rejection (both/neither), topic-in-repo-mode rejection, repo-mode file-enum rejection, `REPO_FILE_ENUM`/`buildConfigPath` coverage
- [x] 4.2 `readConfigFile` tests: repo-mode read, unknown-repo error, XOR/topic/file-enum errors
- [x] 4.3 `proposeConfigUpdate` tests: repo-mode append/replace/delete with correct `{repo}/{file}` path, unknown-repo error (no intent), file-outside-set error, both-role-and-repo error
- [x] 4.4 `configurationFiles` test: `getRepoEntries()` returns all three markdown files; repo count test updated to 3
- [x] 4.5 Apply-handler test: repo-scoped `config_update` writes the correct repo path

## 5. Verify

- [x] 5.1 `npx tsc --noEmit` clean, `npx oxlint` clean on touched files, `npm test` green (5280 passed)
- [x] 5.2 `openspec validate add-repo-config-file-editing --strict`

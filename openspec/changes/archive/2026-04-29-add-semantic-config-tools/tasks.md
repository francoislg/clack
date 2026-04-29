## 1. Schema and shared validation

- [x] 1.1 Create `src/tools/query/configFieldSchemas.ts`. Export three zod constants: `ROLE_ENUM = z.enum(["user","dev","admin","owner"])`, `TOPIC_PATTERN = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i)`, `FILE_PATTERN = z.string().regex(/^[\w][\w.-]*\.md$/)`. Both `readConfigFile.ts` and `proposeConfigUpdate.ts` will import these in their tool schemas; no other consumers in this change.
- [x] 1.2 In the same file, export `buildInstructionPath(role: Role, topic: string | undefined, file: string): string` that returns `${role}/topics/${topic}/${file}` when `topic` is provided and `${role}/${file}` otherwise.
- [x] 1.3 Add unit tests in `src/tools/query/configFieldSchemas.test.ts`:
  - `buildInstructionPath("user", undefined, "identity.md")` returns `"user/identity.md"`
  - `buildInstructionPath("dev", "metabase", "rules.md")` returns `"dev/topics/metabase/rules.md"`
  - Verify `ROLE_ENUM` parses each of the four valid roles, rejects `"developer"` and `""`
  - Verify `TOPIC_PATTERN` accepts `"metabase"`, `"foo-bar_1"`, rejects `".."`, `"foo/bar"`, `"-leading-dash"`, empty string
  - Verify `FILE_PATTERN` accepts `"rules.md"`, `"foo-bar.v2.md"`, rejects `"rules"`, `"rules.txt"`, `"topics/x.md"`, `"my file.md"`, `"file@v2.md"`

## 2. `readInstructionFile` and helper plumbing

- [x] 2.1 In `src/configurationFiles.ts`, extend `readInstructionFile(path: string)` to accept 4-segment topic paths (`{role}/topics/{topic}/{file}`). Internally split and dispatch to `readRoleTopicFile(role, topic, file)`. 2-segment paths continue to dispatch to `readRoleFile(role, file)`. Anything else returns `{ default_content: null, custom_content: null }` (no throw — preserves current no-throw behavior).
- [x] 2.2 Add unit tests in `src/configurationFiles.test.ts` (create file if missing) covering: 2-segment baseline path with file present, 2-segment baseline path with file absent, 4-segment topic path with file present, 4-segment topic path with file absent, 3-segment malformed path returns null/null.
- [x] 2.3 Add a unit test in `src/configurationFiles.test.ts` confirming `writeInstructionFile("dev/topics/newtopic/rules.md", "content")` creates the nested directory `data/configuration/dev/topics/newtopic/` and writes the file. Clean up the test artifact afterward (or use a tmp configuration dir).

## 3. `read_config_file` redesign

- [x] 3.1 Replace the current single `file` parameter with the new schema: `{ role: ROLE_ENUM, topic: TOPIC_PATTERN.optional(), file: FILE_PATTERN }`. Drop the `changesWorkflowEnabled` parameter (it was only used by the resolved-view branch we're deleting).
- [x] 3.2 Remove the `VALID_ROLES.includes(args.file)` resolved-view branch entirely.
- [x] 3.3 In the handler, call `buildInstructionPath(args.role, args.topic, args.file)` and pass the result to `readInstructionFile` (depends on task 2 having landed).
- [x] 3.4 Update the tool description: "Read an instruction file. Returns both default and custom content for comparison. For baseline files, pass `role` and `file`. For topic-scoped files, also pass `topic`."
- [x] 3.5 Update tests in `readConfigFile.test.ts`:
  - Remove tests for the resolved-view branch.
  - Add: read existing baseline file (default+custom both exist, default-only, custom-only), read existing topic file (default+custom, default-only, custom-only), read non-existent baseline (null/null), read non-existent topic (null/null), read with invalid role (zod error), read with topic containing `..` (zod error), read with file lacking `.md` (zod error), read with file containing `/` (zod error).

## 4. `propose_config_update` redesign

- [x] 4.1 Replace the schema: `{ role: ROLE_ENUM, topic: TOPIC_PATTERN.optional(), file: FILE_PATTERN, content: z.string(), operation: z.enum(["append","replace"]).default("append") }`.
- [x] 4.2 Remove the `parts.length !== 2` validation block — the schema now enforces shape statically.
- [x] 4.3 In the handler: compose the path via `buildInstructionPath(args.role, args.topic, args.file)`. Use the composed path for the append-operation read (via `readInstructionFile`) and for the staged intent's `file` field. The staged intent shape stays `{ type: "config_update", file: <composed_path>, content }` — `applyConfigUpdate` is intentionally untouched, since it already calls `writeInstructionFile(intent.file, content)` which handles 4-segment paths via `mkdirSync(..., { recursive: true })`.
- [x] 4.4 Update the tool description to reflect the new field shape and document the topic-file flow ("To edit topic-scoped instructions, also pass `topic`.").
- [x] 4.5 Update tests in `proposeConfigUpdate.test.ts`:
  - Replace path-string cases with field-based cases.
  - Add: propose append on existing baseline, propose append on existing topic, propose replace on baseline, propose replace on topic, propose with operation omitted (defaults to append), propose new file in new topic (no default exists yet), propose with invalid role/topic/file (zod errors).
  - Verify staged intent `file` field is the composed path string for both baseline and topic cases.

## 5. `list_config_files` redesign

- [x] 5.1 Define the new output shape in `listConfigFiles.ts`: `{ roles: RoleEntry[], preAnalysis: FileEntry[], repos: RepoEntry[] }` where:
  - `RoleEntry = { role: string, files: FileEntry[], topics: TopicEntry[] }`
  - `TopicEntry = { topic: string, files: FileEntry[] }`
  - `FileEntry = { file: string, status: "default" | "customized" | "custom-only" | "plugin" | "plugin-customized" }`
  - `RepoEntry = { repo: string, files: FileEntry[] }` (was a flat list with `filename: "{repo}/file.md"` strings — now grouped per repo)
  - `preAnalysis` is a top-level field (not a synthetic role entry), reflecting that `pre-analysis` is not a real role.
- [x] 5.2 Update `listInstructionFiles()` in `src/configurationFiles.ts` to assemble the new shape:
  - Call `listRoleDirFiles()` for baseline files per role (already used today).
  - Call `listRoleTopicDirFiles()` to get topic listings (already exists, currently unused) and group its `(role, topic)` entries under the corresponding `RoleEntry.topics` array. For roles whose topic listings include plugin-contributed virtual defaults, pass through whatever `virtualDefaults` source the existing baseline call uses, so plugin/plugin-customized statuses are preserved.
  - Group repo files by repo name (split on `/` from the existing flat filename strings) into `RepoEntry` objects.
  - Surface `pre-analysis` files via `listSingleDirFiles("pre-analysis")` as the `preAnalysis` field.
  - Skip roles that have neither baseline files nor topic files (consistent with current `listRoleDirFiles` behavior).
- [x] 5.3 Update `listConfigFiles.ts` tool to emit the new shape directly (no transformation in the tool layer beyond what `listInstructionFiles` returns).
- [x] 5.4 Update tests in `listConfigFiles.test.ts`:
  - Replace flat-shape assertions with semantic-shape assertions.
  - Test "role with topic files": call the tool, assert the `user` role's `topics` array contains an entry `{ topic: "metabase", files: [{ file: "rules.md", status: "customized" }] }`.
  - Test "role without topic files": assert the role's `topics` array is `[]` (when the role has baseline files but no topics).
  - Test "multiple topics under one role": assert two distinct `TopicEntry` items appear under the same role.
  - Test "plugin virtual topic file reflected": assert `status: "plugin"` (or `"plugin-customized"` when a custom override exists) for files contributed only via virtual defaults.
  - Test "preAnalysis surfaces at top level": assert files in `data/configuration/pre-analysis/` appear under `preAnalysis`, not under any role.
  - Test "empty role omitted": assert a role with zero baseline files and zero topic files does not appear in the `roles` array.
  - Test "repos grouped per repo": assert `repos` contains one entry per repository with its own `files` array.
- [x] 5.5 Update `listInstructionFiles` tests in `configurationFiles.test.ts` similarly.

## 6. Apply-update handler verification

- [x] 6.1 Locate the button handler that consumes `config_update` intents (likely `src/slack/handlers/applyConfigUpdate.ts` or registered in `src/slack/app.ts`). Confirm it reads `intent.file` as a path string and calls `writeInstructionFile(intent.file, intent.content)`.
- [x] 6.2 Add a test in the apply-handler's test file (or `configUpdateAction.test.ts`, whichever already exists) covering end-to-end for a topic path: propose `{ role: "dev", topic: "metabase", file: "rules.md", content }` → stage intent → apply handler reads intent → asserts the on-disk write hits `data/configuration/dev/topics/metabase/rules.md` and the nested directory was created. Clean up after.

## 7. Instruction prompt updates

- [x] 7.1 Update `data/default_configuration/admin/config-updates.md` (or whichever file teaches the config-edit flow) to describe the new semantic call shape. Include examples for both baseline edits (`{ role: "user", file: "identity.md" }`) and topic edits (`{ role: "dev", topic: "metabase", file: "rules.md" }`).
- [x] 7.2 Audit `data/default_configuration/admin/*.md` and `data/default_configuration/dev/*.md` for any mentions of the old `{role}/{filename}` path-string call shape and update them.
- [x] 7.3 If documentation files reference these tools (e.g., `README.md` sections, `CLAUDE.md` summaries of the tool list), update them. Also updated `data/default_configuration/tool_mapping/clack.json` to use the new field names in label templates (`{role}/{file}`).

## 8. Spec validation and cleanup

- [x] 8.1 Run `openspec validate add-semantic-config-tools --strict` and resolve any reported issues.
- [x] 8.2 Search for residual references to the old path-string shape — `VALID_ROLES.includes`, `parts.length !== 2`, doc comments that mention `{role}/{filename}` syntax — and confirm they're either removed or updated. Two intentional remainders: the `readInstructionFile` docstring still describes the 2-segment baseline format (still accepted by the function), and the Home Tab modal handler keeps its `parts.length !== 2` guard since topic-file editing flows through chat-based MCP tools, not the modal.
- [x] 8.3 Run `npx tsc` to verify type changes ripple cleanly through callers.
- [x] 8.4 Run `npm test` and confirm all suites pass (3019 tests, all green).

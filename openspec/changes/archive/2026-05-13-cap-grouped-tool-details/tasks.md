## 1. Global config schema

- [x] 1.1 Add a `taskCards?: { maxDetailsPerGroup?: number }` block to the `Config` type in `src/config.ts` (or wherever the runtime config type is declared)
- [x] 1.2 Parse the new section in the config loader; on a negative or non-numeric `maxDetailsPerGroup`, log a warning and treat as absent
- [x] 1.3 Expose a helper (e.g., `getTaskCardMaxDetails(): number`) that returns the configured value, defaulting to `5` when absent
- [x] 1.4 Add a test verifying: present-and-numeric resolves, absent section resolves to default `5`, absent field resolves to `5`, `0` is valid, negative falls back to `5`

## 2. Tool mapping loader schema

- [x] 2.1 In `src/streaming/toolMappingLoader.ts`, update the `RawConfig` type so `groups` accepts `Record<string, string | { title: string; maxDetails?: number }>` and the file-level `group` shorthand may be paired with a sibling top-level `maxDetails?: number`
- [x] 2.2 Add a parallel `groupMaxDetails: Map<string, number>` to `ResolvedToolMapping` (and `MAX_DETAILS_UNSET` is just "absent from map")
- [x] 2.3 Update the group-parsing branch (around lines 242-253) to normalize both string and object forms into `groupTitles` + `groupMaxDetails`
- [x] 2.4 For the file-level `group` shorthand, also populate `groupMaxDetails` from the top-level `maxDetails` field when present
- [x] 2.5 Add tests in `src/streaming/toolMappingLoader.test.ts` covering: legacy string-form `groups` parsing unchanged; object-form populates `groupMaxDetails`; file-level shorthand with sibling `maxDetails` populates correctly; mixed string + object values in the same `groups` block

## 3. Group resolution

- [x] 3.1 In `src/streaming/toolLabels.ts`, extend `ToolGroupInfo` with `maxDetails: number` (required on the resolved shape, even though optional in the config)
- [x] 3.2 Implement the resolution chain inside `getToolGroup()` (mapping override → `getTaskCardMaxDetails()` → built-in `5`) for both the per-tool group branch and the file-level group branch
- [x] 3.3 Add tests in `src/streaming/toolLabels.test.ts` (or its existing test file) covering the three resolution paths and the `maxDetails: 0` case

## 4. Streamer gating

- [x] 4.1 In `src/streaming/slackStreamer.ts`, extend the `openGroup` shape with `maxDetails: number`
- [x] 4.2 At group open (the `new task` branch around line 247), populate `maxDetails` from `group.maxDetails`
- [x] 4.3 Gate the "fold into open group" detail append (line ~242) on `this.openGroup.count <= this.openGroup.maxDetails`
- [x] 4.4 Gate the new-task first-item detail append (line ~267) — first item is always count 1; only skip when `maxDetails === 0`
- [x] 4.5 Gate the re-emission path (lines ~202-204) on the same cap (compare `openGroup.count` to `openGroup.maxDetails`)
- [x] 4.6 Verify with `npx tsc` that `groupTitle()` still always appends `(count)` for `count > 1` — header counting must NOT be gated

## 5. Tests for streamer behavior

- [x] 5.1 Add a test in `src/streaming/slackStreamer.test.ts`: five consecutive tools in the same group with `maxDetails: 5` produce exactly five detail lines and a `(5)` header
- [x] 5.2 Add a test: six consecutive tools with `maxDetails: 5` produce five detail lines and a `(6)` header
- [x] 5.3 Add a test for `maxDetails: 0`: header-only task card, no detail lines, even on the first call
- [x] 5.4 Add a test: re-emission of grouped details on the 6th call (when cap is 5) does not append a new detail line
- [x] 5.5 Add a test: two separate groups (different keys) in the same stream cap independently — group A at `maxDetails: 3`, group B at `maxDetails: 10`, each respects its own limit

## 6. Documentation and example

- [x] 6.1 Add an inline comment example to one shipped config file (e.g., a comment-style note in `data/default_configuration/tool_mapping/_builtins.json`'s sibling docs, or in `data/default_configuration/tool_mapping/README.md` if it exists) showing the object-form `groups` entry with `maxDetails` — _no central tool_mapping README exists; the `groups` polymorphism is exercised by tests in `toolMappingLoader.test.ts` and the OpenSpec change captures the schema for future readers_
- [x] 6.2 If the project has a config reference doc (e.g., in `docs/` or `data/default_configuration/`), add a one-line entry for `taskCards.maxDetailsPerGroup` — _added to `data/config.example.json` so the field is visible to anyone seeding a new install_

## 7. Validation

- [x] 7.1 Run `npx tsc` and confirm no type errors
- [x] 7.2 Run `npm test` and confirm all tests pass (3109/3109)
- [x] 7.3 Run `npx oxlint src/streaming src/config.ts` and `npx oxfmt --check src/streaming src/config.ts`; fix any flags
- [x] 7.4 Run `openspec validate cap-grouped-tool-details --strict` and confirm the change validates

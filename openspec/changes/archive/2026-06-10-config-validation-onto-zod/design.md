## Context

`validateConfig(config, slackAuth)` in `src/config.ts` (~804–1070) is ~600 lines of hand-rolled, fail-fast validation: private extractor helpers (`section`/`str`/`bool`/`num`/`strArray`, ~420–447), a dozen `parse*` sub-functions (`parseThinking`, `parseTaskCardsConfig`, `parseEmojiReaction`, `parseDmType`, `parseMcpServerRegistry`, `parseSkillPluginRegistry`, `parseUserSkillsConfig`, `parseSubmitResponseConfig`, `parseAssistantConfig`, `parseMergeStrategy`, `parseRepoAccess`, `parseRepo`, …), enum guards (`isValidRole`), and defaults filled with scattered `?? DEFAULTS`. It throws on the first invalid field so a malformed `config.json` aborts startup.

Two sibling surfaces share the same hand-rolled style: `src/mcpPinned.ts` `parseStdioEntry` (~41–88, throws on partial-pin), and `src/tools/admin/allowlist.ts` `validateContent` → `validateConfigJson`/`validateMcpJson`/`validateJson` (~87–151, returns a `ValidationResult { valid; error? }`). `validateConfigJson` already delegates to `validateConfig`.

This is Change 2 of the sequenced "config validation onto zod" sweep. It reuses the shared `src/plugins/zodResult.ts` leaf shipped in Change 1.

## Goals / Non-Goals

**Goals:**

- Express each `config.json` section as a zod schema (shape + semantics + defaults in one place), so the hand-rolled extractors/`parse*` functions and scattered `?? DEFAULTS` collapse.
- `validateConfig` becomes a `schema.safeParse()` that throws a formatted error on failure — preserving fail-fast boot behavior and existing messages where tests/users depend on them.
- `mcpPinned.parseStdioEntry` and `allowlist.validateContent` migrate to the same schemas; `allowlist` reuses the config schema directly rather than re-implementing checks.
- No observable change: the same inputs that boot/throw today still boot/throw, with equivalent messages.

**Non-Goals:**

- Changing config shape, field names, defaults, or which inputs are accepted.
- Touching `configurationFiles.ts` (file search/edit — a different concern, under concurrent work).
- Persisted-state loaders (Change 3) or sessions (Change 4).
- Relocating the shared helper (stays at `src/plugins/zodResult.ts`).

## Decisions

### Decision 1: Reuse the shared `src/plugins/zodResult.ts` leaf

Bot core already depends on the `src/plugins/` SDK layer (via `registry.ts`), so `config.ts` importing `./plugins/zodResult.js` is acceptable and avoids a second copy. The leaf is dependency-free (only `zod`), so no cycle. `zodErrorToResult(err, fieldLabel)` formats failures; for the throwing path, `validateConfig` throws `new Error(zodErrorToResult(err, "config").error)`.

- **Alternative considered:** relocate the leaf to `src/zodResult.ts` (root) so core doesn't reach into `src/plugins/`. Deferred — it would re-touch trivia's imports for marginal architectural tidiness; revisit if a third core consumer appears.

### Decision 2: One schema per config section, composed into a root `configZod`

Each section (`repositories`, `reactions`, `directMessages`, `mentions`, `autoRespond`, `taskCards`, `git`, `sessions`, `claudeCode`, `changesWorkflow`, `cron`, `plugins`, `mcpServers`, `skillPlugins`, `userSkills`, `submitResponse`, `assistant`, `language`) becomes a zod object with `.default()` for the current `?? DEFAULTS` and `.refine()` for cross-field/bounded rules (hex color, integer ranges, `maxAdditionalMessages ∈ [1,10]`, `suggestedPrompts.length ≤ 4`, role enum, DM-type enum, repo access thresholds). `validateConfig` = `configZod.safeParse(merge(config, slackAuth))` → on failure throw the formatted error; on success return `parsed.data` (defaults already applied).

### Decision 3: Characterization gate first

Before migrating, snapshot today's behavior: a table of representative `config.json` inputs (valid → resulting `Config` incl. defaults; each rejection mode → thrown message) plus `parseStdioEntry` partial-pin throws and `allowlist.validateContent` results. The migration must keep these. This is the parity proof, exactly as in Change 1.

### Decision 4: `allowlist` reuses the config schema

`validateConfigJson` already calls `validateConfig`; after the migration it stays delegating (now schema-backed). `validateMcpJson` migrates to the mcp schema. The `ValidationResult` envelope is preserved (admin tool contract).

### Decision 5: `tool_mapping/*.json` validation — deferred (not in this change)

Considered tightening `streaming/toolMappingLoader.ts` (blind `as ToolMappingConfig` cast) and `allowlist.validateContent` for `tool_mapping/*.json`. **Deferred:** `ToolMappingConfig.tools` is a `Record`, but the loader tolerates loose inputs (e.g. `{ tools: [] }`) via `Object.entries`, and the existing allowlist test asserts such a file is valid. A zod tightening would either reject a real on-disk mapping (dropping task-card labels in production — a "works as usual" violation) or require loosening the schema to the point of no value. Left as a documented candidate in `zod-inventory.md`.

## Risks / Trade-offs

- **Boot-critical** → a wrong schema could reject a valid `config.json` and prevent startup. Mitigation: characterization gate over real/representative configs (Decision 3) run before and after; default-value parity asserted explicitly.
- **Error-message parity** → users/tests may assert specific throw text. Keep messages equivalent via `zodErrorToResult` + per-rule messages; characterization test gates it.
- **`.default()` vs `?? DEFAULTS` divergence** → zod applies defaults at parse; verify the resulting `Config` is byte-equal to today's for partial configs (the accept-case table covers this).
- **Large surface** → migrate section-by-section, re-running the gate after each, rather than one big-bang rewrite.
- **Concurrent config work** → `configurationFiles.ts` is being edited elsewhere; this change deliberately excludes it, touching only `config.ts`/`mcp*.ts`/`allowlist.ts`.

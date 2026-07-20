# Zod validation sweep — inventory

Single source of truth for the "hand-rolled validation → zod schema" sweep. Replaces the
original `zod-plan.md` seed. Re-run 2026-06-09 after Changes 1 & 3 shipped.

**Goal of the sweep:** every place that validates *configuration* or *persisted/external
JSON* by hand (manual `typeof` guards, blind `as` casts, bespoke `parse*`/`isValid*`
functions, scattered `?? DEFAULTS`) should instead be a zod schema — one definition for
shape + semantics + defaults. MCP **tool input schemas were always zod**, so they are not
targets; the target is everything *around* the tools.

The sweep is sequenced into coherent changes by layer/philosophy:

| Philosophy | Meaning |
|---|---|
| **fail-fast** | malformed input throws (boot config, write-time validation) |
| **graceful** | malformed input is tolerated — log + return a default / quarantine |

---

## Status by surface

### ✅ Done (archived)

| Surface | Change | Notes |
|---|---|---|
| `src/plugins/trivia/core/configParsers/*` (axes, axisCheckers, format) | Change 1 | `collapse-trivia-config-validation-onto-zod` |
| `src/plugins-sdk/zodResult.ts` (shared `Result<T>` + `zodErrorToResult` leaf) | Change 1 | imported by both plugins and bot core |
| `src/workers/persistence.ts` (`loadPoolState`) | Change 3 | `persisted-state-loaders-onto-zod` |
| `src/roles.ts` (`loadRoles`) | Change 3 | |
| `src/userPreferences.ts` (`loadPreferences`) | Change 3 | |

Already on zod via other work (not part of this sweep): `casual-talk/config.ts`,
`changes/verification/config.ts`, `repoInstructionFiles.ts`, `slack/blockSchema.ts`,
`tools/query/configFieldSchemas.ts`, and every MCP tool `inputSchema`.

### ⬜ Active changes

| Surface | Change | Style | Status |
|---|---|---|---|
| `src/config.ts` `validateConfig` | **Change 2** `config-validation-onto-zod` | fail-fast | 0/16 |
| `src/mcpPinned.ts` `parseStdioEntry` | Change 2 | fail-fast | |
| `src/tools/admin/allowlist.ts` `validateContent` / `validateMcpJson` | Change 2 | fail-fast | |
| `src/streaming/toolMappingLoader.ts` `loadToolMappings` (blind cast of `tool_mapping/*.json`) | **DEFERRED** | graceful | tightening risks rejecting real mappings (drops task-card labels); `tools` is a `Record` but loader tolerates loose inputs. Candidate, not scheduled. |
| `src/sessions.ts` 3-era load synthesis | **Change 4** `sessions-loader-onto-zod` | graceful | 0/12, OPTIONAL/gated |
| `src/tools/query/findRecentInteractions.ts` + `findSessionTranscript.ts` (`PersistedSession` parsers) | Change 4 *(noted 06-09)* | graceful | read the same session-context file — share the schema |

### 🆕 New — Change 5 `remaining-state-loaders-onto-zod` (graceful cluster)

Change 3 took 3 loaders; the sweep under-counted the persisted-state layer. These 7 share
the identical pattern (blind `as` cast or hand-rolled `isValid*` guard on a runtime-read
JSON file, graceful fallback) and mostly already have unit tests to serve as the gate.

| Surface | Loader | Today | Fallback | Tests |
|---|---|---|---|---|
| `src/workers/quarantine.ts` | `readQuarantineRecord` | `isQuarantineRecord` guard (typeof + `Array.isArray`) | `null` | ✅ `quarantine.test.ts` |
| `src/autoRespond.ts` | `loadRules` | `JSON.parse as Partial<AutoRespondState>` | `[]` | ✅ `autoRespond.test.ts` |
| `src/cronJobs.ts` | `loadJobs` + `sanitizeLoadedJobs` | `as Partial<CronJobState>` + enum sanitize | `[]` | ✅ `cronJobs.test.ts` |
| `src/changes/persistence.ts` | `parseSessionState` | `isValidSessionState` (checks 3 fields) | `null` | ✅ `persistence.test.ts` |
| `src/userSkills.ts` | `readMeta` (+ `validateSlug`/`validateDescription`) | `isValidMetaShape` guard; regex/length input validators | `null` | ✅ `userSkills.test.ts` |
| `src/skillPlugins.ts` | manifest read (~L101) | blind `as` cast | basename defaults | ✅ `skillPlugins.test.ts` |
| `src/errorReports.ts` | `readErrorReport` | blind `as ErrorReport` cast | `null` | ❌ none |

`quarantine.ts` is the most glaring — it sits in `workers/` right beside the file Change 3
already migrated.

### 🔵 Change 6 `slack-payload-schemas-onto-zod` (OPTIONAL; outside the config/MCP goal)

Not "configuration" nor "MCP tools", so outside the original goal scope — but real
hand-rolled validation, scaffolded as an optional tail change. The 9+
`(body.actions[0] as { value: string }).value` casts across `slack/handlers/*` are just
raw-string extraction; the *actual* validation is centralized in one place, so this is a
small clean win:

- `src/slack/blocks.ts` `decodeActionValue` / `tryParseEncodedActionValue` → one
  `EncodedActionValue` zod schema replaces the per-field `typeof` decode.
- `src/slack/handlers/homeTab.ts` modal `private_metadata` (2 blind `as` casts).
- `src/slack/handlers/userSkillsHomeActions.ts` `parseSlugMetadata` / `readInputValue`
  (manual typeof guards on modal `view.state`).

LOW priority (payloads are ephemeral; the decoder is already defensive) — sequence last.

### ⛔ Deliberately excluded (do NOT zod-ify)

| Surface | Why |
|---|---|
| `src/migrations/*` | intentionally parse arbitrary legacy shapes; a schema would reject the very inputs they exist to upgrade |
| `src/tools/query/getSessionTrace.ts` | parses the external **Claude Agent SDK** JSONL trace format — a schema would couple Clack to the SDK's wire format |
| `src/github.ts`, `src/mcpInstaller.ts`, `src/mcpDiagnose.ts`, image-search plugins | parse third-party API responses (network, not our config) |
| `src/plugins/trivia/core/configBridge.ts` field validators | intentional issue-collecting UX (show ALL config problems, not fail on first); top-level already minimally guarded |

### MCP tools — 0 gaps

Every tool `inputSchema` under `src/tools/**` and `src/plugins/*/tools/**` is already zod.
The only MCP-*adjacent* validation gaps are `allowlist.validateMcpJson` (→ Change 2) and the
session-context parsers in the query tools above (→ Change 4).

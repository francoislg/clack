## 1. Config and Permissions

- [x] 1.1 Add `UserSkillsConfig` interface (`{ enabled: boolean }`) and `userSkills?` field to `Config` in `src/config.ts`
- [x] 1.2 Add `parseUserSkillsConfig(input: JsonValue | undefined)` parser and call it from `loadConfig`; reject non-object/unknown-keys/non-boolean
- [x] 1.3 Add config-parser tests in `src/config.test.ts` covering: absent, `{ enabled: true }`, `{ enabled: false }`, invalid types, unknown keys
- [x] 1.4 Add `canCreateUserSkill(role: UserRole): boolean` to `src/permissions.ts` (member+)
- [x] 1.5 Add `canEditUserSkill(role: UserRole, ownerUserId: string, callerUserId: string): boolean` to `src/permissions.ts` (admin+ OR owner matches caller)
- [x] 1.6 Add unit tests for both permission helpers covering each role × owner-match combination

## 2. Storage Module (`src/userSkills.ts`)

- [x] 2.1 Create `src/userSkills.ts` with `UserSkill` interface (`{ slug, description, body, ownerUserId, createdAt, updatedAt, disabledAt? }`)
- [x] 2.2 Implement `validateSlug(slug: string)` enforcing regex `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$` and length 1-64; return `{ ok: true } | { ok: false, reason: string }`
- [x] 2.3 Implement `validateDescription(desc: string)` enforcing 1-1024 chars after trim
- [x] 2.4 Implement `discoverUserSkills(): UserSkill[]` that scans `data/user-skills/`, reads each `SKILL.md` + `.meta.json`, validates frontmatter `name === slug`, skips malformed entries with debug log
- [x] 2.5 Implement `readUserSkill(slug: string): UserSkill | null` for single-skill reads (used by tools)
- [x] 2.6 Implement `writeUserSkill(skill: UserSkill)` that writes `SKILL.md` (frontmatter + body) and `.meta.json` atomically (write to `.tmp`, rename)
- [x] 2.7 Implement `disableUserSkill(slug, now)` / `restoreUserSkill(slug, now)` updating `.meta.json.disabledAt`
- [x] 2.8 Implement DI-friendly `UserSkillsDeps` interface with `existsSync/readFileSync/writeFileSync/statSync/readdirSync/mkdirSync/renameSync/getDataDir/now` mirroring the pattern in `src/skillPlugins.ts`
- [x] 2.9 Add unit tests for `src/userSkills.ts`: validateSlug edge cases, validateDescription edge cases, discover with valid/missing-SKILL.md/missing-.meta.json/name-mismatch/empty-dir, write+read roundtrip, disable+restore roundtrip

## 3. mtime-Keyed Body Cache

- [x] 3.1 Add a process-level `Map<slug, { mtime: number, body: string }>` cache inside `src/tools/query/loadSkill.ts` (or extract to `src/userSkillsBodyCache.ts` if it grows)
- [x] 3.2 Add `getUserSkillBody(slug): { body, fromCache } | { error }` that stat → mtime compare → re-read on mismatch → reject disabled skills
- [x] 3.3 Add `clearUserSkillBodyCache(slug?: string)` to bust the cache; called by watcher and on lifecycle reload
- [x] 3.4 Wire `clearUserSkillBodyCache()` into the lifecycle reload path (next to existing cache resets)
- [x] 3.5 Add unit tests covering: cold load, warm load with unchanged mtime, warm load with changed mtime, disabled-skill rejection, clear-by-slug, clear-all

## 4. Extend `load_skill` and `list_skill_pack_skills`

- [x] 4.1 In `src/tools/query/loadSkill.ts`, branch on `pack === "user-skills"` to delegate to `getUserSkillBody`; preserve existing lazy-plugin behavior for other packs
- [x] 4.2 Ensure user-skills loads are NOT appended to `session.loadedSkills` (mtime cache supersedes session dedup)
- [x] 4.3 Update the unknown-pack error message to include `user-skills` when `userSkills.enabled === true`
- [x] 4.4 In `src/tools/query/listSkillPackSkills.ts`, reject `pack === "user-skills"` with a directive pointing to the inline catalog
- [x] 4.5 Add tests for `loadSkill` covering: cold user-skills load, mtime-cached repeat, mtime-mismatch re-read, disabled-skill rejection, unknown user-skill name, user-skills with feature disabled
- [x] 4.6 Add a test for `listSkillPackSkills` rejecting `user-skills`

## 5. Prompt Catalog Block

- [x] 5.1 In `src/claude/promptBuilder.ts`, locate the existing `AVAILABLE SKILL PACKS` block builder
- [x] 5.2 When `userSkills.enabled === true`, fetch enabled user skills via `discoverUserSkills()` filtered by `!disabledAt`
- [x] 5.3 Render a `USER SKILLS:` subsection beneath the existing lazy-pack list, one line per skill `- <slug> — <description>` alphabetized
- [x] 5.4 Append a directive line: `Use load_skill({ pack: "user-skills", skill: "<slug>" }) to fetch the body.`
- [x] 5.5 Ensure the `AVAILABLE SKILL PACKS` header still renders even when only user skills are present (no lazy-tagged plugins)
- [x] 5.6 Skip the subsection entirely when no enabled user skills exist or feature is off
- [x] 5.7 Add prompt-builder tests covering: subsection rendered with multiple skills (alphabetized), disabled skill excluded, subsection omitted when empty, subsection omitted when feature disabled, header still renders when only user skills exist

## 6. MCP Tools (intent-staging)

- [x] 6.1 Create `src/tools/actions/proposeSkillCreate.ts` mirroring `proposeConfigUpdate.ts`: validate slug + description + body, check slug collision via `readUserSkill`, stage `{ type: "skill_create", slug, description, body, ownerUserId }`, return ref
- [x] 6.2 Create `src/tools/actions/proposeSkillUpdate.ts`: require `name`, require at least one of `description`/`body`, look up existing skill, gate via `canEditUserSkill(role, owner, caller)`, reject if disabled, stage `{ type: "skill_update", slug, description?, body? }`
- [x] 6.3 Create `src/tools/actions/proposeSkillDisable.ts`: look up skill, gate via `canEditUserSkill`, reject if already disabled, stage `{ type: "skill_disable", slug }`
- [x] 6.4 Create `src/tools/actions/proposeSkillRestore.ts`: look up skill, gate via `canEditUserSkill`, reject if not disabled, stage `{ type: "skill_restore", slug }`
- [x] 6.5 Create `src/tools/query/listUserSkills.ts`: anyone, optional `owner` filter, returns formatted text with slug/description/owner/disabled badge
- [x] 6.6 In `src/tools/server.ts`, register the four propose tools and `list_user_skills` behind `if (config.userSkills?.enabled)`; apply role/ownership gates at the tool factory layer
- [x] 6.7 Add `propose_skill_create`, `propose_skill_update`, `propose_skill_disable`, `propose_skill_restore`, `list_user_skills` to `CLACK_CORE_TOOL_NAMES` in `src/tools/toolNameValidator.ts`
- [x] 6.8 Extend the `StagedIntent` discriminated union in `src/tools/types.ts` with the four new intent types
- [x] 6.9 Add unit tests for each propose tool: happy path, validation errors, permission errors, collision (create), already-disabled/not-disabled (disable/restore), unknown slug (update/disable/restore), tool unavailable when feature off
- [x] 6.10 Add unit tests for `listUserSkills`: all skills, owner filter, empty list, disabled badge

## 7. Slack Action Handler

- [x] 7.1 Create `src/slack/handlers/skillAction.ts` registering `app.action(/^clack_skill_action_\d+$/, ...)`
- [x] 7.2 Decode action value to `{ sessionId, ref }` using existing `decodeActionValue` helper
- [x] 7.3 Restore session, fetch staged intent, narrow on `intent.type` (`skill_create` | `skill_update` | `skill_disable` | `skill_restore`)
- [x] 7.4 For each intent type: re-validate inputs, re-check permissions defense-in-depth, re-check collision (create) or current state (disable/restore), apply via `writeUserSkill` / `disableUserSkill` / `restoreUserSkill`
- [x] 7.5 On collision-at-apply (create) or state-mismatch, post an ephemeral error and abort without writing
- [x] 7.6 On success, post a thread confirmation describing what was done
- [x] 7.7 Register the handler in the Slack app bootstrap (where other action handlers register)
- [x] 7.8 Add unit tests for each intent path: success, permission denied, stale collision, stale state

## 8. configWatcher Integration

- [x] 8.1 In `src/configWatcher.ts`, when `userSkills.enabled === true`, recursively watch `data/user-skills/` using existing `watchTreeRecursively`
- [x] 8.2 On change events, clear the body cache (eagerly invalidates everything; mtime check in `getUserSkillBody` still guarantees freshness)
- [x] 8.3 Add an INFO log line identifying the change
- [x] 8.4 Tests: skipped — `fs.watch` is platform-flaky to test reliably and the body cache's mtime check (covered in `userSkillsBodyCache.test.ts`) is the correctness anchor; the watcher is a best-effort freshness optimization

## 9. Home Tab UI

- [x] 9.1 Created `src/slack/userSkillsHomeTab.ts` with `buildUserSkillsSection(viewerUserId, viewerRole, skills)` returning the block array
- [x] 9.2 Header, empty-state, and per-row buttons gated via `canEditUserSkill`
- [x] 9.3 Section placed after Configurations in the main view builder (feature-flag-gated)
- [x] 9.4 Action IDs: `clack_user_skill_create_open`, `clack_user_skill_edit_open:<slug>`, `clack_user_skill_disable:<slug>`, `clack_user_skill_restore:<slug>` — registered in `src/slack/handlers/userSkillsHomeActions.ts`
- [x] 9.5 Create modal: Name/Description/Body inputs with server-side validation; errors surface inline via `response_action: "errors"`
- [x] 9.6 Edit modal: Name shown as read-only context; Description and Body pre-populated and editable; slug carried via `private_metadata`
- [x] 9.7 Modal submissions call the storage layer directly (writeUserSkill / updateUserSkill) — same code paths as the action-button handler converge here
- [x] 9.8 Disable button uses Slack's native button confirm; Restore is direct-apply
- [x] 9.9 Home Tab tests cover section visibility, button visibility per role/ownership, alphabetization, disabled badge

## 10. i18n

- [x] 10.1 Added `userSkills.*` namespace to `src/i18n/strings/en.ts` (modal labels, buttons, validation errors, confirmations, tool-call labels)
- [x] 10.2 Parity entries added to `src/i18n/strings/fr.ts`
- [x] 10.3 Handler/Home Tab code uses `t("userSkills.…")` calls throughout

## 11. Wiring and Smoke

- [x] 11.1 Added `data/user-skills/` to `.gitignore`
- [x] 11.2 `npx tsc --noEmit` passes
- [x] 11.3 `npm test` passes — 4225 tests, 0 failures
- [x] 11.4 `npx oxlint` and `npx oxfmt --check` pass on all new files

## 12. Documentation

- [x] 12.1 Updated `CLAUDE.md` with the new tools list, the user-created-skills section, and the `data/user-skills/` entry in the data layout
- [ ] 12.2 Update `data/default_configuration/user/integrations.md` to mention the user-skills pack alongside the lazy-skill fallback rule — deferred (existing fallback rule covers it via the catalog's load_skill directive; can be tightened later)
- [x] 12.3 `openspec validate add-user-created-skills --strict` passes

## 13. Manual Verification

- [ ] 13.1 With `userSkills.enabled: false`: verify tools are not registered, Home Tab has no Skills section, prompt has no USER SKILLS subsection
- [ ] 13.2 Flip to `userSkills.enabled: true` via config.json: verify lifecycle reload picks it up; tools appear; Home Tab section appears
- [ ] 13.3 Create a skill via Slack chat (Claude calls `propose_skill_create`, click confirm): verify SKILL.md + .meta.json written, skill appears in catalog on next turn
- [ ] 13.4 Use the new skill via `load_skill` in a follow-up turn: verify body is returned
- [ ] 13.5 Edit the skill's description via Home Tab Edit modal: verify catalog reflects new description on next turn
- [ ] 13.6 Edit the body on disk directly (touch `SKILL.md`): verify next `load_skill` call returns the new body (mtime cache busted)
- [ ] 13.7 Disable the skill via Home Tab: verify it disappears from the catalog and `load_skill` returns "unknown skill"
- [ ] 13.8 Restore the skill: verify it reappears
- [ ] 13.9 Try editing someone else's skill as a member: verify denied; as an admin: verify allowed
- [ ] 13.10 Try creating a skill with an invalid slug from Slack chat: verify the tool rejects with a clear error

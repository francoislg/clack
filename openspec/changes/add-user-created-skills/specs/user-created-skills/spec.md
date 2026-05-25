## ADDED Requirements

### Requirement: userSkills Config Block

The system SHALL accept an optional `userSkills` block in `data/config.json` with an `enabled: boolean` field. When `enabled` is `false` or the block is absent, the feature SHALL be fully inert: none of the new MCP tools are registered, the prompt catalog renders no "USER SKILLS" subsection, the Home Tab Skills section is hidden, and the `data/user-skills/` directory is ignored even if it contains files. The parser SHALL reject non-object `userSkills`, non-boolean `enabled`, and unknown sibling keys with clear errors.

#### Scenario: Default disabled when block absent

- **GIVEN** `data/config.json` contains no `userSkills` field
- **WHEN** `loadConfig()` runs
- **THEN** the returned Config has `userSkills.enabled === false` (or `userSkills` is `undefined` and consumers treat that as disabled)
- **AND** no user-skills MCP tools are registered for new sessions

#### Scenario: Explicit enable

- **GIVEN** `data/config.json` contains `"userSkills": { "enabled": true }`
- **WHEN** `loadConfig()` runs
- **THEN** `getConfig().userSkills.enabled` is `true`

#### Scenario: Invalid type rejected

- **GIVEN** `data/config.json` contains `"userSkills": { "enabled": "yes" }`
- **WHEN** `loadConfig()` runs
- **THEN** a clear error identifying `userSkills.enabled` as requiring boolean is thrown

#### Scenario: Toggling enabled hot-reloads via lifecycle

- **GIVEN** Clack is running with `userSkills.enabled: false`
- **WHEN** an admin edits `data/config.json` to set `userSkills.enabled: true`
- **THEN** the existing config watcher triggers a full lifecycle reload
- **AND** subsequent new sessions register the user-skills MCP tools
- **AND** subsequent prompt builds include the "USER SKILLS" subsection (when at least one enabled skill exists)

### Requirement: User Skill Storage Layout

When `userSkills.enabled === true`, the system SHALL recognize user-authored skills under `data/user-skills/<slug>/` where each `<slug>` directory contains:
- `SKILL.md` — YAML frontmatter (`name`, `description`) followed by the body
- `.meta.json` — a JSON sidecar with `{ ownerUserId, createdAt, updatedAt, disabledAt? }`

The `name` field in the SKILL.md frontmatter MUST equal the directory slug. Directories missing `SKILL.md` or `.meta.json` SHALL be ignored (logged at debug level). The `data/user-skills/` directory does NOT need to exist for the feature to be enabled; an empty pack is valid.

#### Scenario: Discovery finds well-formed skills

- **GIVEN** `data/user-skills/copy-improver/SKILL.md` exists with frontmatter `name: copy-improver` and a non-empty description
- **AND** `data/user-skills/copy-improver/.meta.json` exists with valid JSON
- **WHEN** the user-skills discovery scans the directory
- **THEN** `copy-improver` is returned in the result list with its metadata

#### Scenario: Directory missing SKILL.md is ignored

- **GIVEN** `data/user-skills/broken/.meta.json` exists but `data/user-skills/broken/SKILL.md` does not
- **WHEN** discovery scans
- **THEN** `broken` is NOT included in the result list
- **AND** a debug-level log records the skip reason

#### Scenario: Directory missing .meta.json is ignored

- **GIVEN** `data/user-skills/orphan/SKILL.md` exists but `data/user-skills/orphan/.meta.json` does not
- **WHEN** discovery scans
- **THEN** `orphan` is NOT included in the result list

#### Scenario: Frontmatter name mismatch is ignored

- **GIVEN** `data/user-skills/foo/SKILL.md` has frontmatter `name: bar`
- **WHEN** discovery scans
- **THEN** the skill is NOT included in the result list
- **AND** a debug-level log records the name mismatch

### Requirement: Slug Validation

The system SHALL validate slugs against the Claude Code skill spec: `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`, length 1 to 64. Validation SHALL run both at the MCP tool layer (rejecting bad input before staging) and at the handler layer (defense in depth). The description (frontmatter `description` / "trigger") SHALL be 1 to 1024 characters after trimming.

#### Scenario: Valid slug accepted

- **WHEN** Claude calls `propose_skill_create({ name: "copy-improver", ... })`
- **THEN** the tool stages the intent

#### Scenario: Uppercase rejected

- **WHEN** Claude calls `propose_skill_create({ name: "CopyImprover", ... })`
- **THEN** the tool returns a validation error identifying the slug as requiring lowercase

#### Scenario: Leading hyphen rejected

- **WHEN** Claude calls `propose_skill_create({ name: "-bad", ... })`
- **THEN** the tool returns a validation error identifying the slug as not allowed to start with a hyphen

#### Scenario: Double hyphen rejected

- **WHEN** Claude calls `propose_skill_create({ name: "double--hyphen", ... })`
- **THEN** the tool returns a validation error identifying the slug as not allowed to contain consecutive hyphens

#### Scenario: Trailing hyphen rejected

- **WHEN** Claude calls `propose_skill_create({ name: "trailing-", ... })`
- **THEN** the tool returns a validation error identifying the slug as not allowed to end with a hyphen

#### Scenario: Over-length slug rejected

- **WHEN** Claude calls `propose_skill_create({ name: "a".repeat(65), ... })`
- **THEN** the tool returns a validation error identifying the 64-char limit

#### Scenario: Empty description rejected

- **WHEN** Claude calls `propose_skill_create({ name: "x", description: "  ", body: "..." })`
- **THEN** the tool returns a validation error identifying the description as required and non-empty after trimming

#### Scenario: Over-length description rejected

- **WHEN** Claude calls `propose_skill_create({ name: "x", description: "a".repeat(1025), body: "..." })`
- **THEN** the tool returns a validation error identifying the 1024-char limit

### Requirement: propose_skill_create Tool

The `propose_skill_create({ name, description, body })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL be available to any user permitted by `canCreateUserSkill(role)` (member or higher). The tool SHALL stage a `skill_create` intent containing `{ slug, description, body, ownerUserId }` and return a ref ID for embedding in `submit_response`. The tool SHALL reject calls when a skill with the same slug already exists (whether enabled or disabled).

#### Scenario: Successful staging

- **GIVEN** the caller is a member and the slug `copy-improver` does not yet exist
- **WHEN** Claude calls `propose_skill_create({ name: "copy-improver", description: "...", body: "..." })`
- **THEN** the tool returns text including a ref ID and a summary of the staged skill
- **AND** the intent store contains an entry of type `skill_create` keyed by that ref

#### Scenario: Slug collision rejected

- **GIVEN** `data/user-skills/copy-improver/` already exists (enabled or disabled)
- **WHEN** Claude calls `propose_skill_create({ name: "copy-improver", ... })`
- **THEN** the tool returns an error identifying the slug as already taken
- **AND** the tool guidance suggests updating the existing skill or choosing a different slug

#### Scenario: Tool unavailable when feature disabled

- **GIVEN** `userSkills.enabled === false`
- **WHEN** Claude attempts to call `propose_skill_create`
- **THEN** the tool is not registered for the session and the call fails at the SDK layer (or is rejected by the server with "tool not available")

### Requirement: propose_skill_update Tool

The `propose_skill_update({ name, description?, body? })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL stage a `skill_update` intent. At least one of `description` or `body` MUST be provided. The tool SHALL allow staging only when `canEditUserSkill(role, ownerUserId, callerUserId)` is true — i.e., the caller is the skill's owner OR has role `admin` or `owner`. The tool SHALL reject updates to disabled skills, directing the caller to use `propose_skill_restore` first.

#### Scenario: Owner can stage update

- **GIVEN** `copy-improver` is owned by Slack user U123 and the caller is U123
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", body: "..." })`
- **THEN** the tool stages a `skill_update` intent and returns a ref ID

#### Scenario: Admin can stage update on someone else's skill

- **GIVEN** `copy-improver` is owned by U123 and the caller is an admin U456
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", description: "..." })`
- **THEN** the tool stages the intent and returns a ref ID

#### Scenario: Non-owner non-admin rejected

- **GIVEN** `copy-improver` is owned by U123 and the caller is U789 (member, non-owner)
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", ... })`
- **THEN** the tool returns an error identifying the caller as lacking edit permission for that skill

#### Scenario: Update to unknown slug rejected

- **WHEN** Claude calls `propose_skill_update({ name: "ghost", body: "..." })`
- **THEN** the tool returns an error identifying the skill as not found

#### Scenario: Update to disabled skill rejected

- **GIVEN** `copy-improver` has `disabledAt` set in its `.meta.json`
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", body: "..." })`
- **THEN** the tool returns an error directing the caller to restore the skill first

#### Scenario: Missing both description and body rejected

- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver" })`
- **THEN** the tool returns a validation error identifying at least one of `description` or `body` as required

### Requirement: propose_skill_disable Tool

The `propose_skill_disable({ name })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL stage a `skill_disable` intent. Permission gate is the same as `propose_skill_update`: owner OR admin+. Already-disabled skills SHALL be rejected.

#### Scenario: Owner can stage disable

- **GIVEN** `copy-improver` is owned by U123, enabled, and the caller is U123
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver" })`
- **THEN** the tool stages the intent and returns a ref ID

#### Scenario: Disable on already-disabled skill rejected

- **GIVEN** `copy-improver` has `disabledAt` already set
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver" })`
- **THEN** the tool returns an error identifying the skill as already disabled

#### Scenario: Non-owner non-admin rejected

- **GIVEN** caller U789 is not the owner and not admin+
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver" })`
- **THEN** the tool returns an error identifying the caller as lacking permission

### Requirement: propose_skill_restore Tool

The `propose_skill_restore({ name })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL stage a `skill_restore` intent that clears `disabledAt`. Permission gate is owner OR admin+. Restore SHALL reject skills that are not currently disabled.

#### Scenario: Owner can stage restore on their disabled skill

- **GIVEN** `copy-improver` is owned by U123 and `disabledAt` is set
- **WHEN** the caller U123 calls `propose_skill_restore({ name: "copy-improver" })`
- **THEN** the tool stages the intent and returns a ref ID

#### Scenario: Restore on enabled skill rejected

- **GIVEN** `copy-improver` has no `disabledAt`
- **WHEN** Claude calls `propose_skill_restore({ name: "copy-improver" })`
- **THEN** the tool returns an error identifying the skill as not disabled

### Requirement: list_user_skills Tool

The `list_user_skills({ owner? })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL return all enabled user skills (or all when no filter), each line showing the slug, description, owner Slack user ID, and "(disabled)" badge if applicable. An optional `owner` arg filters by `ownerUserId`. The tool SHALL be available to anyone with tool access (no role gate).

#### Scenario: List all enabled skills

- **GIVEN** three enabled user skills and one disabled
- **WHEN** Claude calls `list_user_skills({})`
- **THEN** the tool returns text listing all four skills, with the disabled one marked

#### Scenario: Filter by owner

- **GIVEN** `copy-improver` owned by U123 and `meeting-notes` owned by U456
- **WHEN** Claude calls `list_user_skills({ owner: "U123" })`
- **THEN** the tool returns only `copy-improver`

#### Scenario: Empty pack

- **GIVEN** no user skills exist
- **WHEN** Claude calls `list_user_skills({})`
- **THEN** the tool returns a clear "no user skills found" message

### Requirement: Slack Action Handler for Skill Intents

The system SHALL register a Slack action handler matching `^clack_skill_action_\d+$` that decodes the action value to `{ sessionId, ref }`, restores the staged intent, re-checks permissions defense-in-depth, and applies the action atomically (writes `SKILL.md` and `.meta.json` together; updates `.meta.json` only for disable/restore). On successful apply, the handler SHALL post a confirmation reply in the originating thread.

#### Scenario: Create intent applied

- **GIVEN** a staged `skill_create` intent for slug `copy-improver`
- **WHEN** the requester clicks the confirm button
- **THEN** the handler creates `data/user-skills/copy-improver/SKILL.md` with the frontmatter and body
- **AND** creates `data/user-skills/copy-improver/.meta.json` with `ownerUserId`, `createdAt`, `updatedAt` set to the same timestamp
- **AND** posts a confirmation in the thread

#### Scenario: Update intent applied

- **GIVEN** a staged `skill_update` intent for slug `copy-improver` with new body
- **WHEN** the requester clicks confirm
- **THEN** the handler overwrites `SKILL.md` with the new content
- **AND** sets `.meta.json.updatedAt` to the current timestamp
- **AND** preserves `ownerUserId` and `createdAt`

#### Scenario: Disable intent applied

- **GIVEN** a staged `skill_disable` intent for `copy-improver`
- **WHEN** the requester clicks confirm
- **THEN** the handler writes `.meta.json` with `disabledAt` set to the current timestamp
- **AND** does NOT touch `SKILL.md`
- **AND** the skill no longer appears in the prompt catalog on subsequent turns

#### Scenario: Restore intent applied

- **GIVEN** a staged `skill_restore` intent for a disabled `copy-improver`
- **WHEN** the requester clicks confirm
- **THEN** the handler writes `.meta.json` with `disabledAt` removed
- **AND** the skill reappears in the prompt catalog on subsequent turns

#### Scenario: Defense-in-depth permission re-check

- **GIVEN** a staged `skill_update` intent created when the caller was the owner
- **AND** the caller's role/ownership has changed (e.g., ownership transferred, role lost) between staging and confirm
- **WHEN** the button is clicked
- **THEN** the handler re-evaluates `canEditUserSkill(role, ownerId, callerId)` and rejects if it fails
- **AND** posts an ephemeral error explaining the missing permission

#### Scenario: Slug collision at apply time

- **GIVEN** a staged `skill_create` intent for slug `x`
- **AND** between staging and confirm, another user created a skill named `x`
- **WHEN** the button is clicked
- **THEN** the handler detects the collision and aborts without overwriting
- **AND** posts an error explaining the collision

### Requirement: Permission Predicates

The system SHALL expose two permission helpers in `src/permissions.ts`:
- `canCreateUserSkill(role: UserRole): boolean` returns `true` for `member`, `dev`, `admin`, and `owner`
- `canEditUserSkill(role: UserRole, ownerUserId: string, callerUserId: string): boolean` returns `true` when `role` is `admin` or `owner`, OR when `ownerUserId === callerUserId`

Both helpers SHALL be pure (no I/O) so they can be used uniformly at the tool gate, handler defense-in-depth, and Home Tab button visibility check.

#### Scenario: Member can create

- **WHEN** `canCreateUserSkill("member")` is called
- **THEN** it returns `true`

#### Scenario: Owner can edit their own

- **WHEN** `canEditUserSkill("member", "U123", "U123")` is called
- **THEN** it returns `true`

#### Scenario: Non-owner member cannot edit

- **WHEN** `canEditUserSkill("member", "U123", "U999")` is called
- **THEN** it returns `false`

#### Scenario: Admin can edit anything

- **WHEN** `canEditUserSkill("admin", "U123", "U999")` is called
- **THEN** it returns `true`

#### Scenario: Owner role can edit anything

- **WHEN** `canEditUserSkill("owner", "U123", "U999")` is called
- **THEN** it returns `true`

### Requirement: mtime-Keyed Body Cache

The system SHALL maintain a process-level cache for user-skill bodies keyed by `slug → { mtime, body }`. On every `load_skill` call against the `user-skills` pack, the implementation SHALL `statSync` the on-disk `SKILL.md`, compare `mtimeMs` against the cached entry, and re-read from disk on mismatch. Disabled skills SHALL be excluded from cache lookups (returned as "not found"). The cache SHALL be cleared on full lifecycle reloads.

#### Scenario: Fresh load reads from disk

- **GIVEN** no cache entry for slug `copy-improver`
- **WHEN** `load_skill({ pack: "user-skills", skill: "copy-improver" })` is called
- **THEN** the SKILL.md is read from disk
- **AND** the cache stores `(slug, mtime, body)`

#### Scenario: Repeat load with unchanged mtime returns cached body

- **GIVEN** the cache holds `(copy-improver, mtime=T1, body)`
- **AND** the file on disk still has mtime `T1`
- **WHEN** `load_skill` is called again
- **THEN** the cached body is returned without re-reading
- **AND** the cache is unchanged

#### Scenario: mtime mismatch triggers re-read

- **GIVEN** the cache holds `(copy-improver, mtime=T1, oldBody)`
- **AND** the file on disk has been written and now has mtime `T2`
- **WHEN** `load_skill` is called
- **THEN** the file is re-read
- **AND** the cache is updated to `(copy-improver, mtime=T2, newBody)`

#### Scenario: Disabled skill not loadable

- **GIVEN** `copy-improver` has `disabledAt` set
- **WHEN** `load_skill({ pack: "user-skills", skill: "copy-improver" })` is called
- **THEN** the tool returns an error identifying the skill as not found
- **AND** the cache is not populated

#### Scenario: Cache cleared on lifecycle reload

- **GIVEN** the cache holds entries for two enabled skills
- **WHEN** a lifecycle reload triggered by `config.json` change occurs
- **THEN** the cache is cleared
- **AND** the next `load_skill` call re-reads from disk

### Requirement: configWatcher Observability for User Skills

The system SHALL extend `startConfigWatcher` (in `src/configWatcher.ts`) to recursively watch `data/user-skills/` when `userSkills.enabled === true`. Change events SHALL clear the body cache for the affected slug (best-effort — if the path can't be resolved to a slug, the entire user-skills body cache is cleared) and log an INFO line. The watcher is best-effort; correctness of body freshness comes from the mtime check in `load_skill`.

#### Scenario: SKILL.md change clears cache entry

- **GIVEN** the watcher is running and the body cache holds an entry for `copy-improver`
- **WHEN** `data/user-skills/copy-improver/SKILL.md` is written to disk
- **THEN** the watcher fires and clears the cache entry for `copy-improver`
- **AND** logs an INFO line identifying the change

#### Scenario: New skill directory picked up by next discovery

- **GIVEN** the watcher is running
- **WHEN** `data/user-skills/new-skill/SKILL.md` is created
- **THEN** the watcher fires for the parent directory
- **AND** the next prompt-build discovery scan finds `new-skill`

### Requirement: Tool Name Validator Registration

The four new MCP tool names (`propose_skill_create`, `propose_skill_update`, `propose_skill_disable`, `propose_skill_restore`, `list_user_skills`) SHALL be added to `CLACK_CORE_TOOL_NAMES` in `src/tools/toolNameValidator.ts` so the validator does not reject them when assembling the tool list.

#### Scenario: Validator accepts new tool names

- **WHEN** the tool name validator is asked to validate the assembled tool list including the user-skills tools
- **THEN** all five names pass validation

## Why

Skills today are statically vendored under `data/skill-plugins/<plugin>/` and require ops to drop a Claude Code plugin marketplace into the project before Clack can use it. There is no path for an org member to author a new skill from Slack, no notion of skill ownership, and no admin UI to manage skill content the way configurations and schedules can be managed today. The `add-lazy-skill-loading` work already gave us the catalog rendering and on-demand body loader we need; this change reuses that machinery to expose a friendly authoring flow.

## What Changes

- New `data/user-skills/<slug>/` storage for member-authored skills (one directory per skill, each with `SKILL.md` + `.meta.json` sidecar carrying `ownerUserId`, `createdAt`, `updatedAt`, and optional `disabledAt`).
- New `userSkills` config block in `data/config.json` with an `enabled` flag (single virtual pack in v1; storage layout leaves room for a future `packs: {...}` extension without breaking).
- New "USER SKILLS" subsection inside the existing `AVAILABLE SKILL PACKS` catalog block — one line per skill rendered inline with the frontmatter `description` (so triggers are always in baseline context, not behind a `list_skill_pack_skills` round-trip).
- Four new MCP tools, mirroring the `propose_config_update` intent-staging pattern (Claude calls → ref ID returned → Slack button confirms → handler applies):
  - `propose_skill_create` (member+ via `canCreateUserSkill`)
  - `propose_skill_update` (skill owner OR admin+ via `canEditUserSkill`)
  - `propose_skill_disable` (skill owner OR admin+; soft-disable, sets `disabledAt`)
  - `list_user_skills` (anyone with tool access; optional `owner` filter)
- `load_skill` extended to recognize the synthetic `user-skills` pack and return bodies of user-authored skills with a `(slug, mtime)`-keyed cache, so edits are picked up by the next call without restart.
- New Slack action handler `clack_skill_action_<n>` (single handler, three intent types: create/update/disable/restore).
- Home Tab gains a "Skills" section (parallel to Configurations and Schedules): list with owner badge, `+ Create skill` button, per-row Edit/Disable/Restore buttons, modal with trigger + body textareas and inline name-validation feedback.
- New permission helpers `canCreateUserSkill(role)` (member+) and `canEditUserSkill(role, ownerId, callerId)` (owner OR admin+).
- `configWatcher.ts` watches `data/user-skills/` recursively and busts the load-skill body cache on change. `data/config.json` toggle of `userSkills.enabled` is picked up via the existing lifecycle reload — no new wiring needed.
- Disabled (soft-deleted) skills are hidden from the prompt catalog and from `load_skill`, but remain on disk and visible in the Home Tab with a "Restore" button (admin+ or owner).

## Capabilities

### New Capabilities
- `user-created-skills`: Member-authored skills stored under `data/user-skills/<slug>/`, with ownership tracking, intent-staged create/update/disable tools, soft-disable semantics, and Home Tab management.

### Modified Capabilities
- `lazy-skill-loading`: The `AVAILABLE SKILL PACKS` catalog block gains a "USER SKILLS" subsection that lists each enabled user skill inline by its frontmatter description; `load_skill` accepts `pack: "user-skills"` and reads from `data/user-skills/<slug>/SKILL.md` with mtime-keyed caching; the user-skills virtual pack does NOT appear in `list_skill_pack_skills`'s pack listing for lazy packs because it is not a directory under `data/skill-plugins/`.
- `home-tab`: Adds a Skills section between Configurations and Schedules, with the same shape as Configurations (list + create + edit modal + per-row actions).
- `cascading-config-resolver`: No spec change, but the `configWatcher.ts` startup wiring gains a `data/user-skills/` recursive watcher entry that invalidates the load-skill body cache.

## Impact

- **New code**:
  - `src/userSkills.ts` — discovery, slug validation, read/write/disable, mtime-cache, ownership predicates
  - `src/tools/actions/proposeSkillCreate.ts`, `proposeSkillUpdate.ts`, `proposeSkillDisable.ts`
  - `src/tools/query/listUserSkills.ts`
  - `src/slack/handlers/skillAction.ts`
  - Home Tab block builders for the Skills section (in `src/slack/homeTab.ts` and `src/slack/blocks.ts`)
- **Modified code**:
  - `src/config.ts` — new `userSkills` config block + parser
  - `src/permissions.ts` — `canCreateUserSkill`, `canEditUserSkill`
  - `src/tools/server.ts` — register the four new tools, gated by `config.userSkills.enabled`
  - `src/tools/query/loadSkill.ts` — recognize `pack: "user-skills"`, mtime cache
  - `src/claude/promptBuilder.ts` — render "USER SKILLS" subsection in the catalog block
  - `src/configWatcher.ts` — watch `data/user-skills/` and bust the load-skill body cache
  - `src/i18n/strings/en.ts` + `fr.ts` — user-facing strings (modal labels, button text, error messages)
- **Tool-name validator**: add `propose_skill_create`, `propose_skill_update`, `propose_skill_disable`, `list_user_skills` to `CLACK_CORE_TOOL_NAMES`.
- **Migration**: none required. The feature defaults to `userSkills.enabled = false`; existing deployments are untouched until an admin opts in.
- **Dependencies**: builds on `add-lazy-skill-loading` (already wired in runtime: `load_skill`, `list_skill_pack_skills`, `discoverEagerSkillPlugins`).
- **Baseline token impact**: each enabled user skill adds ~100–200 tokens to the per-turn prompt catalog. Acceptable; degrades gracefully (the catalog block is per-turn, not baseline-baked). No hard cap in v1, but ops can hide a skill via the disable flow if cost becomes a concern.
- **Backwards compatibility**: fully backwards-compatible. Feature is off by default; turning it on adds tools and a Home Tab section but does not change any existing behavior.

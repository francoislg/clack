## Context

Clack today exposes skills only via the vendored Claude Code plugin marketplaces under `data/skill-plugins/<plugin>/`. Adding a skill requires ops to drop a new plugin directory into the project, restart Clack, and let session-start pick it up via `--plugin-dir`. The `add-lazy-skill-loading` change (already landed in runtime: `load_skill`, `list_skill_pack_skills`, `discoverEagerSkillPlugins`) introduced a parallel Clack-owned catalog for lazy packs so their bodies are loaded on demand rather than baked into baseline. That gives us most of the rendering and tool-invocation plumbing this change needs.

What's missing is an authoring loop: members should be able to create skills from Slack, see them in the Home Tab next to configurations and schedules, and have those skills appear in Claude's context with always-on trigger descriptions and on-demand body loading. The propose-intent pattern used by `proposeConfigUpdate` already gives us a clean model: Claude stages an intent → returns a ref → Slack button confirms → handler applies.

The SDK does not allow mid-session mutation of the `--plugin-dir` set, so user skills cannot be SDK-registered plugins. They must be a virtual pack rendered into the per-turn prompt and read on demand — the same shape `add-lazy-skill-loading` uses, with a different storage root.

## Goals / Non-Goals

**Goals:**
- Members+ can create skills via Claude in Slack (via `propose_skill_create`), receive a confirm button, and the skill becomes live on the next turn.
- Owners can edit/disable their own skills; admins+ can edit/disable any.
- Each skill's frontmatter `description` is always visible in Claude's context (rendered per-turn into a "USER SKILLS" subsection of the existing `AVAILABLE SKILL PACKS` catalog block) so Claude can pick skills naturally without a discovery round-trip.
- Skill bodies are loaded on demand via the existing `load_skill` tool extended to recognize the synthetic `user-skills` pack.
- Edits hot-reload — both trigger updates (next turn) and body updates (next `load_skill` call after the file changes).
- Disabling is soft: file stays on disk, hidden from prompt + `load_skill`, restorable from Home Tab.
- Home Tab gains a "Skills" section with list, create, edit, disable/restore.
- Feature is config-gated and off by default; backwards-compatible.

**Non-Goals:**
- Multi-pack support. v1 is a single virtual pack. Storage layout (`data/user-skills/<slug>/`) leaves room for a future `data/user-skills/<pack>/<slug>/` migration without breaking, but no multi-pack config or UI in this change.
- Per-skill ACLs (private/team/org scoping). All enabled skills are visible to everyone Clack serves.
- Versioning / history. Skill edits overwrite. Git-tracking of `data/user-skills/` is out of scope (it joins the existing data/ gitignore).
- Promoting user skills into git-tracked plugins.
- Hard delete. Disable is the terminal state; we don't ship a "delete forever" path. Operators can `rm -rf` the directory if they really mean it.
- Exporting / importing skills across Clack installations.
- A hard cap on number of user skills. We trust operators to disable noise.

## Decisions

### Storage: filesystem-per-skill outside `data/skill-plugins/`

Each skill lives at `data/user-skills/<slug>/`:
- `SKILL.md` — standard Claude Code skill format: YAML frontmatter (`name`, `description`) + body
- `.meta.json` — sidecar JSON: `{ ownerUserId, createdAt, updatedAt, disabledAt? }`

**Alternatives considered:**
- *Single regenerated plugin under `data/skill-plugins/clack-user-skills/`*: reuses plugin machinery but the SDK bakes plugins at session start, so trigger edits would only land for new sessions. Rejected.
- *Single JSON registry (`data/state/user-skills.json` with bodies inline)*: atomic but bloats with body content, loses SKILL.md shape, harder to migrate to a real plugin later. Rejected.

**Why this wins:** the storage shape is identical to a real SKILL.md, which means a future "promote to git-tracked plugin" feature is purely a directory move. The `.meta.json` sidecar isolates Clack-only metadata from skill content. The virtual-pack model also keeps these skills entirely outside the SDK plugin set, sidestepping the no-hot-reload constraint.

### Single virtual pack, multi-pack-extensible layout

v1 ships with one logical pack named `user-skills`. The directory layout `data/user-skills/<slug>/` is intentionally flat — no pack subdirectory. If we later add multi-pack support, the migration is: rename `data/user-skills/<slug>/` → `data/user-skills/default/<slug>/` and adopt nested discovery. Tools take `pack` as an arg today (always `"user-skills"`), so the API shape doesn't need to change either.

**Alternative considered:** ship multi-pack now with a `packs: {}` config block. Rejected — adds real config surface (per-pack lazy flag, per-pack create permission, Home Tab pack picker) for a benefit nobody has asked for yet.

### Triggers inline in the prompt, bodies lazy

The existing `AVAILABLE SKILL PACKS` catalog block lists *packs* with pack-level descriptions; `list_skill_pack_skills` is required to see individual skill triggers. For user skills that's the wrong shape — each user skill has a unique trigger, and the value of an org skill is being immediately discoverable.

So the catalog block gains a "USER SKILLS" subsection that lists each enabled user skill inline with its frontmatter description:

```
AVAILABLE SKILL PACKS:
- marketingskills — Marketing playbooks: CRO, copywriting, SEO  (call list_skill_pack_skills...)
- ...

USER SKILLS:
- copy-improver — When the user wants to improve marketing copy on internal pages
- meeting-notes — When the user wants to summarize a meeting transcript
(use load_skill({ pack: "user-skills", skill: "<name>" }) to apply)
```

Two pack types share one prompt block, which keeps the existing fallback instruction in `integrations.md` working: if Claude reaches for `Skill("foo")` and it's unknown, it checks the catalog and tries `load_skill`.

**Cost:** ~100–200 tokens per user skill in every turn. Acceptable v1; degrades via disable.

### Reuse `load_skill`, add a synthetic pack

`load_skill({ pack: "user-skills", skill: "<slug>" })` is the on-demand body fetch. The existing tool already has session-level idempotency (`loadedSkills: Array<{ pack, skill }>`); we extend that contract minimally:
- The pack name `"user-skills"` is reserved and resolves to `data/user-skills/<slug>/SKILL.md`
- Read path is mtime-keyed: cache stores `(slug → { mtime, body })`. If the on-disk mtime differs, the cache entry is dropped and a fresh read happens (overrides session idempotency for user skills only; we treat trigger-aware re-loads as a feature, not a regression).
- Disabled skills return an "unknown skill" error matching the existing scheme.

`list_skill_pack_skills` does NOT enumerate the user-skills pack — user skills are already enumerated in the prompt catalog. Calling `list_skill_pack_skills({ pack: "user-skills" })` returns an error directing Claude to read the inline catalog instead.

### Intent-staged tools, mirror `proposeConfigUpdate`

Tools live under `src/tools/actions/` and stage intents via `IntentStore.stage(...)`:

| Tool | Caller gate | Intent type |
|------|-------------|-------------|
| `propose_skill_create` | `canCreateUserSkill(role)` — member+ | `skill_create` |
| `propose_skill_update` | `canEditUserSkill(role, ownerId, callerId)` — owner OR admin+ | `skill_update` |
| `propose_skill_disable` | same as update | `skill_disable` (or `skill_restore` to undo) |
| `list_user_skills` | anyone with tool access; not gated by `canEditUserSkill` | n/a (read-only) |

Each propose-tool returns a ref ID Claude embeds in `submit_response`. A Slack action button (regex `clack_skill_action_\d+`) carries `{ sessionId, ref }`, the handler re-reads the intent, re-checks permissions defense-in-depth, and applies. Mirrors `configUpdateAction.ts` exactly.

**Restore** is the inverse of disable — re-uses the same handler with intent type `skill_restore` (or a flag on the disable intent). For Home Tab restore (no Claude in the loop), the button is a direct admin action analogous to existing Home Tab buttons.

### Name validation

Slug rules (matching the existing Claude Code skill spec at `agentskills.io/specification.md`):
- `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$` — lowercase a-z/0-9/hyphens; 1-64 chars; no leading/trailing/double hyphens
- Frontmatter `name` field MUST equal the directory slug (we generate the SKILL.md from input, so we enforce this on write)
- Description: 1-1024 chars (per the spec); non-empty trimmed

Validation runs at the tool layer (rejecting bad input before staging) and again in the handler (defense in depth, mostly to surface clear errors if intent serialization corrupts something).

### Hot-reload

Two paths, both already largely free:

1. **Trigger updates** — `promptBuilder` rebuilds the "USER SKILLS" subsection on every turn by re-scanning `data/user-skills/`. An edit to a `SKILL.md` description lands in the next turn for every active thread. No cache to invalidate.
2. **Body updates** — `load_skill` for user skills consults a process-level `Map<slug, { mtime, body }>`. On call, `statSync(...).mtimeMs` is compared; mismatch → re-read. Cheap (one stat per call) and avoids file-watcher race conditions.

`configWatcher.ts` adds a recursive watcher on `data/user-skills/` for observability (log "user skill changed" lines) and to clear the body cache eagerly on directory rename/removal events that mtime alone wouldn't catch. The watcher is best-effort; correctness comes from the mtime check.

`data/config.json` already triggers a full lifecycle reload via the existing `onConfigJsonChange` hook, so toggling `userSkills.enabled` picks itself up — no new wiring.

### Permissions model

```
canCreateUserSkill(role): boolean
  → role is member or higher (i.e., always true for any authenticated user with tool access)

canEditUserSkill(role, ownerUserId, callerUserId): boolean
  → role is admin or higher, OR callerUserId === ownerUserId
```

The owner field is the Slack `userId` of the creator at time of `propose_skill_create`. We don't model ownership transfer in v1; an admin can edit anything, which covers the "person left the company" case.

### i18n

User-facing strings (modal labels, button text, error messages surfaced to the requester) go through `t()` and are added to both `en.ts` and `fr.ts`. Tool descriptions Claude reads stay English, per repo convention.

### Backwards compatibility / migration

No migration. Feature is off by default (`userSkills.enabled` defaults to `false`). When the flag is `false`:
- The four MCP tools are not registered.
- The "USER SKILLS" subsection is not rendered (skipped entirely if the pack would be empty or the flag is off).
- The Home Tab Skills section is hidden.
- `data/user-skills/` may still exist on disk (e.g., if an operator manually populated it for testing) — it's simply ignored until the flag flips on.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Token bloat from many user skills — every trigger is paid every turn | Per-turn rendering means we can introduce a cap or alphabet-sort + truncate later without breaking the spec; ops can disable noisy skills. Document the per-skill cost (~100–200 tokens) in the Home Tab footer. |
| Active session caches a stale body if `load_skill` is called twice in one turn around an edit | mtime-keyed cache is checked on every call, so within-turn writes (rare) are picked up. Cross-turn: every turn rebuilds the catalog and any subsequent `load_skill` re-checks mtime. |
| Disabled skills accumulate forever | Soft delete is the v1 contract. If accumulation becomes a real concern, a future "purge disabled older than N days" admin tool is additive. |
| Name collision with a built-in plugin's skill (e.g., user creates `copywriting` while `marketingskills` has the same name) | Allowed. Claude's catalog shows them separately (`marketingskills/copywriting` vs `user-skills/copywriting`); `load_skill` requires both `pack` and `skill`, so disambiguation is unambiguous. The frontmatter `name` field is a per-pack scope, not a global one. |
| Slack button approving a stale intent applies an edit against a version of the skill that has since changed | Same risk profile as `proposeConfigUpdate` (which applies-on-confirm against latest disk state). Acceptable; intent payload carries full `SKILL.md` content, so the apply step is a complete-overwrite, not a diff-merge. |
| Disabling a skill mid-thread → in-flight `load_skill` call after disable surfaces an "unknown skill" error to Claude | Acceptable v1 — Claude will summarize that the skill is unavailable and proceed. Adding a graceful re-fetch path is additive. |
| Hot-reload watcher on `data/user-skills/` is one more `fs.watch` consumer; on Linux, `recursive: true` is ignored so we walk the tree | The existing `watchTreeRecursively` helper already handles this. Subdirectories created at runtime aren't picked up by new watchers (existing limitation), but mtime checks in `load_skill` cover that gap. |
| Permission check has to happen at three layers (tool gate, handler defense-in-depth, Home Tab button visibility) | Centralize the predicates in `src/permissions.ts` (`canCreateUserSkill`, `canEditUserSkill`) so all three call the same function. |

## Open Questions

- **Should we expose a skill-rename flow?** Currently rename = create new + disable old. Rename would need to update the slug, the `name` frontmatter field, and the directory name atomically. v1 punts; if it's common we add `propose_skill_rename` later.
- **Should `list_user_skills` be available to all users or gated by some tool-access threshold?** Defaulting to "anyone with tool access" to match the inline catalog they already see in their prompt.
- **Do we want to render disabled skills in the Home Tab Skills section, or hide them behind a "Show disabled" toggle?** Defaulting to "show all with a 'disabled' badge" for v1 — simpler UI, surfaces the restore button.

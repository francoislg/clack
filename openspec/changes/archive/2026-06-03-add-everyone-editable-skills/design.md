## Context

User-created skills currently expose a single permission predicate, `canEditUserSkill(role, ownerUserId, callerUserId)`, which returns true for admins+ or the skill's own creator. This one gate is the chokepoint for *every* mutating surface: Home Tab edit-button visibility, the open/disable/restore/edit-submit Home Tab actions, the `propose_skill_update`/`propose_skill_disable`/`propose_skill_restore` MCP tools, and their `skillAction`/`autoExecute` apply paths.

We want a per-skill opt-in (`editableByAnyone`) that lets any member edit a skill's **content** while keeping its **lifecycle** (disable/restore) and the flag itself owner/admin-only. Because one gate currently covers both content and lifecycle, the central design move is splitting that gate in two.

Ownership/state lives in `.meta.json` (`UserSkillMeta`: `ownerUserId`, `createdAt`, `updatedAt`, `disabledAt?`), kept separate from `SKILL.md` (Claude-facing frontmatter + body). The disabled state already renders as a Home Tab badge — the new flag mirrors that pattern.

## Goals / Non-Goals

**Goals:**
- Add an optional, default-off `editableByAnyone` attribute to a skill, persisted in `.meta.json`.
- Let any member+ edit the description/body of a skill marked `editableByAnyone`.
- Keep disable/restore and toggling the flag restricted to the skill owner or admin+.
- Let the owner/admin set the flag from the Home Tab edit modal AND from `propose_skill_update`.
- Show an "editable by everyone" badge in the Home Tab and make the edit modal permission-aware.

**Non-Goals:**
- No new role or config-block. The flag is per-skill, not workspace-wide.
- No change to skill *creation* permission (`canCreateUserSkill` stays member+).
- No data migration — absence of the field reads as `false`.
- Everyone-editable does NOT widen who can disable/restore or who can flip the flag.

## Decisions

### Split `canEditUserSkill` into two predicates
Replace the single predicate with:
- `canEditUserSkillContent(role, ownerUserId, callerUserId, editableByAnyone)` — `true` when admin+, OR caller is owner, OR (`editableByAnyone` && member+). Gates description/body edits.
- `canManageUserSkill(role, ownerUserId, callerUserId)` — the prior behavior (admin+ OR owner). Gates disable, restore, and toggling `editableByAnyone`.

**Why over a boolean param on the existing function:** the two capabilities now diverge (one is flag-widened, one is not) and are called from different sites. Two named predicates make each call site's intent explicit and keep the flag from accidentally leaking into lifecycle gates. Every call site passes `skill.editableByAnyone` only where content is concerned.

**Alternative considered:** keep one predicate, add an `action: "content" | "manage"` discriminator. Rejected — a discriminated gate is easy to mis-call (forget the arg → wrong default) and reads worse at the call site than two intention-revealing names.

### Store the flag in `.meta.json`, not frontmatter
`editableByAnyone?: boolean` joins `UserSkillMeta` next to `ownerUserId`/`disabledAt`. Frontmatter (`SKILL.md`) is Claude-facing skill *content*; meta is the permission/state ledger. A permission flag belongs with ownership, not in the body Claude reads. Absent field ⇒ `false` (backward-compatible; no migration).

### Permission-aware edit modal
`buildEditSkillModal` gains a `canManage` parameter. When `false` (a member editing an everyone-editable skill), the modal renders the description/body inputs only — no Disable/Restore button and no editable-by-anyone checkbox. When `true`, it renders the checkbox (initial value = current flag) and the lifecycle button as today. The Home Tab edit *button* shows whenever `canEditUserSkillContent` is true; what's *inside* the modal is scoped by `canManageUserSkill`.

### Flag-setting threads through both write surfaces
- **Home Tab:** the edit-submit handler reads the checkbox and passes `editableByAnyone` to `updateUserSkill`, but ONLY after re-checking `canManageUserSkill` — a member submitting a content edit cannot set the flag (the checkbox isn't even rendered for them, defense-in-depth on submit regardless).
- **MCP:** `propose_skill_update` gains an optional `editable_by_anyone` field. Content fields (`description`/`body`) gate on `canEditUserSkillContent`; if `editable_by_anyone` is present, the tool additionally requires `canManageUserSkill` and rejects otherwise. The staged `skill_update` intent carries the flag, and the `skillAction` apply path re-checks management before persisting it.

### `updateUserSkill` accepts and preserves the flag
`UpdateUserSkillInput` gains `editableByAnyone?: boolean`. When provided, it's written to meta; when omitted, the existing value is preserved (same pattern as description/body). `writeUserSkill` (create) also accepts it, defaulting to absent. `disableUserSkill`/`restoreUserSkill` preserve the flag untouched.

## Risks / Trade-offs

- **A member could be surprised that "edit" doesn't include disable.** → The modal simply omits the Disable button for non-managers; there's no failed action to confuse them. Tool errors for `propose_skill_disable` already name the missing permission.
- **Stale staged intent flips the flag after permission was lost.** → The `skillAction` apply path already re-checks permissions defense-in-depth; we extend that re-check to `canManageUserSkill` for the flag write, so a revoked manager can't land a staged flag change.
- **Two predicates risk a call site using the wrong one.** → Content sites pass the flag; lifecycle sites don't take it. A lifecycle site calling the content predicate would be a type-visible extra arg; unit tests cover both predicates and each call site's gating.
- **i18n parity.** → New badge/checkbox strings need en + fr with non-identical values (parity test enforced); fr translations provided, not copied.

## Context

User skills (`data/user-skills/<slug>/`) currently support a soft lifecycle only: `disableUserSkill` stamps `disabledAt` in `.meta.json`, `restoreUserSkill` clears it. There is no path to remove a skill's files. Both the Home Tab (`src/slack/handlers/userSkillsHomeActions.ts`, gated by `canManageUserSkill`) and the conversational flow (staged `StagedIntent` → `clack_skill_action_N` button → `src/slack/handlers/skillAction.ts`) already implement the disable/restore pair, so hard-delete slots into both existing rails.

Deletion is irreversible, so the user chose to gate it at **admin+ only** — stricter than disable/restore, which also allow the skill's own owner.

## Goals / Non-Goals

**Goals**
- A `deleteUserSkill(slug)` storage op that recursively removes the skill directory.
- A `canDeleteUserSkill(role)` predicate (admin+).
- Home Tab Delete button (admin+ only) with a native confirmation dialog.
- `propose_skill_delete` MCP tool + `skill_delete` staged intent so admins can ask Clack.

**Non-Goals**
- No "trash"/undo or retention window — delete is immediate and permanent (disable already covers reversible removal).
- No bulk delete.
- No data migration (no persisted-file schema change).

## Decisions

### Storage: recursive remove via an injected dep
`UserSkillsDeps` currently has no recursive-remove function. Add `rmSync: (path, opts?: { recursive: boolean; force: boolean }) => void` (wrapping `node:fs` `rmSync`) so the op stays mockable, consistent with the existing DI pattern (`writeFileSync`, `renameSync`, etc.). `deleteUserSkill(slug)`:
1. `validateSlug(slug)` — reject bad shapes before touching the filesystem (defense against path escape).
2. `readUserSkill(slug)` (or `userSkillExists`) — throw "not found" if absent.
3. `deps.rmSync(getSkillDir(slug), { recursive: true, force: true })`.

Works regardless of `disabledAt`. No atomic-rename dance needed — a directory removal is already a single syscall and there is no half-written state to guard.

### Permission: dedicated `canDeleteUserSkill(role)`
Add `canDeleteUserSkill(role: UserRole): boolean { return meetsMinimumRole(role, "admin"); }` rather than reusing `canManageUserSkill` (which also allows the owner) or `canEditConfig` (semantically unrelated). A dedicated predicate keeps the gate explicit at all three sites (tool gate, handler defense-in-depth, Home Tab visibility) and is easy to test.

### Conversational path: one tool, `delete` flag (no new tool)
Per the requested constraint, do NOT add a `propose_skill_delete` tool. Instead extend the existing `propose_skill_disable` (`src/tools/actions/proposeSkillDisable.ts`) with an optional `delete: boolean`:
- `propose_skill_disable({ name, delete?: boolean })`. When `delete` is absent/`false`, behavior is unchanged (soft-disable, gated by `canManageUserSkill`). When `delete: true`, the tool gates on `canDeleteUserSkill(role)` (admin+), rejects unknown slugs, and stages a `skill_delete` intent. The tool description documents the flag and stresses that `delete: true` is permanent/irreversible whereas the default is reversible.
- A `delete: true` call does NOT require the skill to be enabled — a disabled skill can be deleted directly (no "already disabled" rejection on the delete path).
- Extend the `StagedIntent` union in `src/tools/types.ts` with `{ type: "skill_delete"; slug: string }`. Keeping a distinct intent (rather than a flag on `skill_disable`) gives the action handler a clean branch with its own apply logic, confirmation copy, and defense-in-depth gate.
- Add `applyDelete` to `src/slack/handlers/skillAction.ts` and a `case "skill_delete"` in the switch. `applyDelete` re-reads the skill, re-checks `canDeleteUserSkill(role)` (defense-in-depth — role may have dropped since staging), calls `deps.deleteUserSkill`, and posts a confirmation. Add `deleteUserSkill` to `SkillActionDeps` + `defaultSkillActionDeps`.
- No change to `src/tools/server.ts` registration — the tool is already registered; only its input schema and internal branching change.

### Home Tab: admin-only Delete button with native confirm
- In `src/slack/userSkillsHomeTab.ts`: add `ACTION_DELETE_PREFIX = "clack_user_skill_delete"`. Render a Delete button per row only when `canDeleteUserSkill(viewerRole)` — on both enabled and disabled rows. Attach a Slack `confirm` object (title/text/confirm/deny) so the destructive action requires explicit confirmation.
- In `src/slack/handlers/userSkillsHomeActions.ts`: register an action handler for `clack_user_skill_delete:<slug>` that resolves the viewer role, re-checks `canDeleteUserSkill`, calls `deleteUserSkill`, and `refreshHomeView`. Mirrors the existing disable/restore handlers.

### i18n
New keys in `en.ts` + `fr.ts` (FR translated, not identical): `userSkills.delete_button`, `userSkills.delete_confirm_title`, `userSkills.delete_confirm_text`, `userSkills.delete_confirm_ok`, `userSkills.delete_confirm_cancel`, `userSkills.deleted`, `userSkills.delete_failed`, plus a `userSkills.delete_permission_denied` (or reuse the generic `permission_denied`). The button label/confirm strings are on the direct-to-Slack path → must go through `t()`. The MCP tool description and `textResult`/`errorResult` envelopes stay English (via-Claude path).

## Risks / Trade-offs

- **Irreversible data loss.** Mitigated by: admin+ gate, native confirmation dialog in the UI, defense-in-depth re-check at apply time, and tool guidance emphasizing permanence. Disable remains the reversible default.
- **Concurrent delete + in-flight edit.** If a skill is deleted while an `skill_update` button is pending, the update's apply-time `readUserSkill` returns null and already posts a "not found" error — no new handling needed.
- **Body cache staleness.** The mtime-keyed body cache keys on `SKILL.md`; after delete the file is gone, so `getSkillMtimeMs` returns null and the cache entry is effectively dead. Confirm the cache tolerates a missing file (it already guards `existsSync`).

## Migration Plan

None. No persisted-file format changes; the feature is purely additive. Existing skills are unaffected until an admin explicitly deletes one.

## Open Questions

- Should a Home Tab delete also drop an audit log line (who deleted what, when)? Out of scope unless requested — current lifecycle ops don't audit either.

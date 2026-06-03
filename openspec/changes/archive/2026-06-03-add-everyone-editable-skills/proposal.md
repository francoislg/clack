## Why

User-created skills can only have their content edited by the skill's creator or an admin+. There is no way to open a skill up for collaborative editing by the whole workspace. We want a per-skill opt-in that lets the owner (or an admin) mark a skill as editable by anyone, so shared skills can be maintained by the people who use them — without handing out broad admin rights.

## What Changes

- Add an optional `editableByAnyone: boolean` attribute to a user skill, persisted in the skill's `.meta.json` (alongside `ownerUserId`/`disabledAt`), defaulting to absent/`false`.
- **Split the single edit gate into two capabilities:**
  - **Content editing** (description + body): widened so that when `editableByAnyone` is set, any member+ can edit. Owner and admins+ retain access regardless.
  - **Management** (disable, restore, and toggling `editableByAnyone` itself): unchanged — owner or admin+ only. The flag does NOT widen these.
- Make the flag settable by the skill owner or admin+ from two surfaces:
  - The Home Tab edit modal (a checkbox, rendered only when the viewer can manage the skill).
  - `propose_skill_update` (a new `editable_by_anyone` field; setting it requires the management gate).
- Make the edit modal **permission-aware**: a member editing an everyone-editable skill sees the description/body inputs but NOT the Disable button or the editable-by-anyone checkbox.
- Surface the flag in the Home Tab: an "editable by everyone" badge on the skill row, mirroring the existing disabled badge.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `user-created-skills`: add the `editableByAnyone` attribute; split content-edit permission from management permission; widen content editing to member+ when the flag is set; specify who can set the flag and where; specify Home Tab badge and permission-aware modal behavior.

## Impact

- **Code:**
  - `src/permissions.ts` — split `canEditUserSkill` into `canEditUserSkillContent` (flag-widened) and `canManageUserSkill` (owner/admin only).
  - `src/userSkills.ts` — add `editableByAnyone` to `UserSkill`/`UserSkillMeta`, read/write it in meta, accept it on create/update inputs.
  - `src/slack/userSkillsHomeTab.ts` — badge, permission-aware edit modal, checkbox.
  - `src/slack/handlers/userSkillsHomeActions.ts` — gate edit/disable/restore against the correct capability; persist the flag on submit.
  - `src/slack/handlers/skillAction.ts`, `src/slack/handlers/autoExecute.ts` — update to the split gates.
  - `src/tools/actions/proposeSkillUpdate.ts` — widen content gate, add `editable_by_anyone` field gated by management; `proposeSkillDisable.ts`/`proposeSkillRestore.ts` keep the management gate.
- **i18n:** new keys for the badge (and checkbox label) in `src/i18n/strings/en.ts` + `fr.ts` (parity test enforced).
- **Data:** `.meta.json` gains an optional field; older meta files without it read as `false` (backward-compatible, no migration required).
- **Tests:** permission unit tests, userSkills meta round-trip, Home Tab render/gating, propose tool gating.

## Why

User skills can only be soft-disabled (`disabledAt` set) or restored — there is no way to permanently remove one. The skill's directory, `SKILL.md`, and `.meta.json` linger on disk forever, so a mistakenly-created or obsolete skill cannot be cleaned up without an operator manually `rm -rf`-ing the host filesystem. Admins need a way to delete a skill for good, both from the Home Tab UI and conversationally by asking Clack.

## What Changes

- Add a `deleteUserSkill(slug)` storage operation that permanently removes the entire `data/user-skills/<slug>/` directory (SKILL.md, `.meta.json`, any tmp files). It works on both enabled and disabled skills.
- Add a `canDeleteUserSkill(role)` permission predicate gating delete to **admin+ only** — stricter than disable/restore (which allow the skill owner). A plain member can disable their own skill but cannot irreversibly delete it.
- Add a **Delete** button to each Home Tab Skills row, rendered only for admin+, with a native Slack confirmation dialog (irreversible).
- Extend the existing `propose_skill_disable` MCP tool with an optional `delete: boolean` flag instead of adding a new tool. `delete: true` stages a `skill_delete` intent (permanent removal) and is gated by `canDeleteUserSkill` (admin+); omitting it preserves today's soft-disable behavior. A `skill_delete` staged-intent branch in the Slack action handler re-checks the admin+ gate at apply time.
- Add localized strings for the delete button, confirmation, success, and failure messages.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `user-created-skills`: adds the `deleteUserSkill` storage op, the `propose_skill_delete` tool, the `skill_delete` action-handler branch, and the `canDeleteUserSkill` permission predicate.
- `home-tab`: adds an admin-only Delete button (with confirmation) to each Skills-section row.

## Impact

- **Code:** `src/userSkills.ts` (new `deleteUserSkill` + a recursive-remove dep on `UserSkillsDeps`), `src/permissions.ts` (`canDeleteUserSkill`), `src/tools/actions/proposeSkillDisable.ts` (add `delete` flag + admin+ gate when set), `src/tools/types.ts` + `StagedIntent` union (`skill_delete`), `src/slack/handlers/skillAction.ts` (`applyDelete` branch), `src/slack/handlers/userSkillsHomeActions.ts` (Home Tab delete handler), `src/slack/userSkillsHomeTab.ts` (Delete button + action prefix), `src/i18n/strings/en.ts` + `fr.ts` (new keys).
- **Data:** irreversible filesystem removal of `data/user-skills/<slug>/`. No migration needed (no schema change to persisted files).
- **No breaking changes** to existing disable/restore/create/update behavior.

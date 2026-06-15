# Tasks

## 1. Storage operation
- [x] 1.1 Add `rmSync` (recursive/force) to `UserSkillsDeps` and `defaultUserSkillsDeps` in `src/userSkills.ts`.
- [x] 1.2 Implement `deleteUserSkill(slug)`: validate slug → throw if not found → `rmSync(getSkillDir(slug), { recursive: true, force: true })`. Works on enabled and disabled skills.
- [x] 1.3 Unit tests in `src/userSkills.test.ts` (mocked deps): deletes the directory; works on disabled skill; throws on unknown slug; invalid slug touches nothing.

## 2. Permission predicate
- [x] 2.1 Add `canDeleteUserSkill(role): boolean` (admin+) to `src/permissions.ts`.
- [x] 2.2 Unit tests in `src/permissions.test.ts`: member/dev → false; admin/owner → true.

## 3. Conversational path (ask Clack) — one tool, `delete` flag
- [x] 3.1 Add `{ type: "skill_delete"; slug: string }` to the `StagedIntent` union in `src/tools/types.ts`.
- [x] 3.2 Extend `propose_skill_disable` in `src/tools/actions/proposeSkillDisable.ts` with an optional `delete: boolean`. When `delete: true`: gate on `canDeleteUserSkill(role)`, reject unknown slug, do NOT reject an already-disabled skill, stage `skill_delete`. When absent/`false`: unchanged soft-disable. Update the tool description to document the flag + stress permanence (English). No `src/tools/server.ts` change (tool already registered).
- [x] 3.3 Add `deleteUserSkill` to `SkillActionDeps` + `defaultSkillActionDeps`; add `applyDelete` and a `case "skill_delete"` to `src/slack/handlers/skillAction.ts`, re-checking `canDeleteUserSkill` and posting confirmation/failure.
- [x] 3.4 Tests: extend `src/tools/actions/proposeSkillStateChange.test.ts` (delete flag: admin stages `skill_delete`; non-admin owner rejected; unknown slug rejected; already-disabled allowed; flag absent keeps soft-disable) and `src/slack/handlers/skillAction.test.ts` (delete applied; defense-in-depth re-check rejects demoted clicker).

## 4. Home Tab UI (Edit modal lifecycle section)
- [x] 4.1 In `src/slack/userSkillsHomeTab.ts`: add `ACTION_DELETE_PREFIX`; thread a `canDelete` arg into `buildEditSkillModal` and render a Delete button (danger, native `confirm` dialog) in the lifecycle actions block when `canDelete`, on both enabled and disabled skills.
- [x] 4.2 In `src/slack/handlers/userSkillsHomeActions.ts`: pass `canDeleteUserSkill(role)` at the `buildEditSkillModal` call site; register `registerDelete` handling `clack_user_skill_delete:<slug>` — resolve role, re-check `canDeleteUserSkill`, call `deleteUserSkill`, close the modal, `refreshHomeView`.
- [x] 4.3 Tests: `src/slack/userSkillsHomeTab.test.ts` (Delete shown only when `canDelete`, on both states, carries confirm) and a handler test for the delete action (applies + refreshes; non-admin no-ops).

## 5. i18n
- [x] 5.1 Add `userSkills.delete_button`, `delete_confirm_title`, `delete_confirm_text`, `delete_confirm_ok`, `delete_confirm_cancel`, `deleted`, `delete_failed` keys to `src/i18n/strings/en.ts` and translated values to `fr.ts`.
- [x] 5.2 Confirm `src/i18n/parity.test.ts` passes (key/placeholder parity; no FR value identical to EN unless allowlisted).

## 6. Verify
- [x] 6.1 `npx tsc` clean, `npx oxlint` + `npx oxfmt --check` clean on touched files.
- [x] 6.2 `npm test` green.
- [x] 6.3 `openspec validate add-user-skill-hard-delete --strict` passes.

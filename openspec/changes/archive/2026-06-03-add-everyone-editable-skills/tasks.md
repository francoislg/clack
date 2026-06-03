## 1. Data model

- [x] 1.1 Add `editableByAnyone?: boolean` to `UserSkill` and `UserSkillMeta` in `src/userSkills.ts`
- [x] 1.2 Read `editableByAnyone` in `readMeta`/`readSkillFromDisk` (default to absent/false); extend `isValidMetaShape` to allow an optional boolean
- [x] 1.3 Accept `editableByAnyone` on `CreateUserSkillInput` and `UpdateUserSkillInput`; write it in `writeUserSkill`/`updateUserSkill`, preserving the existing value when omitted
- [x] 1.4 Ensure `disableUserSkill`/`restoreUserSkill` preserve `editableByAnyone` untouched
- [x] 1.5 Add/extend unit tests in `src/userSkills.test.ts`: absent reads false, round-trip true, preserved across content update + disable + restore

## 2. Permission predicates

- [x] 2.1 In `src/permissions.ts`, replace `canEditUserSkill` with `canEditUserSkillContent(role, ownerUserId, callerUserId, editableByAnyone)` (admin+ | owner | (editableByAnyone && member+))
- [x] 2.2 Add `canManageUserSkill(role, ownerUserId, callerUserId)` (admin+ | owner)
- [x] 2.3 Update `src/permissions.test.ts` to cover both predicates per spec scenarios

## 3. MCP tools

- [x] 3.1 `src/tools/actions/proposeSkillUpdate.ts`: add optional `editable_by_anyone` field; require at least one of description/body/editable_by_anyone; gate content on `canEditUserSkillContent`, gate the flag on `canManageUserSkill`; stage `editableByAnyone` on the intent
- [x] 3.2 `src/tools/actions/proposeSkillDisable.ts` and `proposeSkillRestore.ts`: swap gate to `canManageUserSkill` (behavior unchanged; flag must not widen)
- [x] 3.3 Extend the `skill_update` intent type (in `src/tools/server.ts` / intent store) to carry optional `editableByAnyone`
- [x] 3.4 Update tool unit tests (`*.test.ts`) for the new field and the split gating scenarios

## 4. Apply path (handlers)

- [x] 4.1 `src/slack/handlers/skillAction.ts`: use split predicates in defense-in-depth re-checks — content via `canEditUserSkillContent`, flag change + disable/restore via `canManageUserSkill`; persist `editableByAnyone` from the staged update intent
- [x] 4.2 `src/slack/handlers/autoExecute.ts`: update the injected gate deps and call sites to the split predicates
- [x] 4.3 Update `skillAction`/`autoExecute` tests for the new gating and flag persistence

## 5. Home Tab UI

- [x] 5.1 `src/slack/userSkillsHomeTab.ts`: render edit button via `canEditUserSkillContent` (pass `skill.editableByAnyone`); add the editable-by-everyone badge on the row
- [x] 5.2 Add a `canManage` parameter to `buildEditSkillModal`; render the editable-by-everyone checkbox (initial = current flag) and the Disable/Restore button only when `canManage` is true; always render description/body inputs
- [x] 5.3 `src/slack/handlers/userSkillsHomeActions.ts`: gate open-edit-modal on content predicate; gate disable/restore on `canManageUserSkill`; on edit-submit, read the checkbox and persist `editableByAnyone` only after re-checking `canManageUserSkill`
- [x] 5.4 Thread `canManageUserSkill` into the modal build call site(s)
- [x] 5.5 Update Home Tab render/action tests for badge, permission-aware modal, and flag persistence

## 6. i18n

- [x] 6.1 Add badge + checkbox-label (and any helper) keys to `src/i18n/strings/en.ts`
- [x] 6.2 Add non-identical fr translations to `src/i18n/strings/fr.ts`
- [x] 6.3 Confirm the i18n parity test passes

## 7. Verify

- [x] 7.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on touched files
- [x] 7.2 `npm test` green
- [x] 7.3 `openspec validate add-everyone-editable-skills --strict`

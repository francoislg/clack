## 1. Keyword detection

- [x] 1.1 In `src/claude/promptBuilder.ts`, add `ADMIN_CLAIM_KEYWORDS` (fixed list: `"as an admin"`, `"as admin"`, `"en tant qu'admin"`, `"je suis admin"`, `"admin:"`) and an exported `messageClaimsAdmin(text)` that lowercases, normalizes curly apostrophes, and substring-matches the list
- [x] 1.2 Add a module-local `latestUserText(session)` returning the last user continuation if any, else `triggerText(session)` (so detection keys on the latest message, not stale thread text)

## 2. Gated context renderer

- [x] 2.1 Add exported `renderAdminClaimContext(role, latestUserText)`: returns `""` unless `messageClaimsAdmin(latestUserText)` is true
- [x] 2.2 Branch `admin`/`owner` → verified-role line + deference directive (per design.md Decision 2); MAY state a concern once, fence against relaxing tool gating / security boundary / destructive-action safety
- [x] 2.3 Branch `member`/`dev` → not-verified rebuttal naming the actual role, stating the claim confers no authority, refuse admin deference + admin-gated actions, silent (Claude decides whether to mention)
- [x] 2.4 Branch `system`/`undefined` → `""`
- [x] 2.5 In `buildPrompt`, after the delivery-context push, call `renderAdminClaimContext(options?.role, latestUserText(session))` and `parts.push` only when non-empty

## 3. Tests (`src/claude/promptBuilder.test.ts`)

- [x] 3.1 `messageClaimsAdmin`: each keyword matches; case-insensitive; curly-apostrophe variant; negatives (ordinary text, "the admin dashboard", undefined, "")
- [x] 3.2 `renderAdminClaimContext`: admin/owner+claim → deference; member/dev+claim → rebuttal (no deference); any role + no claim → ""; system/undefined+claim → ""
- [x] 3.3 `renderAdminClaimContext`: deference text does NOT relax the security boundary and bounds to one concern
- [x] 3.4 `buildPrompt` integration: admin+keyword → deference; admin no-keyword → nothing (not always-on); member/dev+keyword → rebuttal, no deference; role omitted+keyword → nothing
- [x] 3.5 `buildPrompt` latest-message scope: keyword only in original trigger + later non-keyword continuation → no deference; keyword only in latest continuation → deference

## 4. Verification

- [x] 4.1 `npx tsc` clean
- [x] 4.2 `npx oxlint` + `npx oxfmt --check` clean on touched files
- [x] 4.3 `npm test` green
- [ ] 4.4 `openspec validate add-admin-deference-posture --strict` passes

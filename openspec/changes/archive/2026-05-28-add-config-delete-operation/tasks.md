## 1. Type layer

- [x] 1.1 In `src/tools/types.ts`, change `StagedConfigUpdateIntent` from a struct to a discriminated union: `{ type: "config_update"; operation: "write"; file: string; content: string } | { type: "config_update"; operation: "delete"; file: string }`. Keep `StagedIntentType` unchanged.
- [x] 1.2 Update any other type aliases or unions in `src/tools/types.ts` that referenced the old struct shape.

## 2. Tool layer (`propose_config_update`)

- [x] 2.1 In `src/tools/actions/proposeConfigUpdate.ts`, extend the `operation` Zod enum to `["append", "replace", "delete"]`.
- [x] 2.2 Make the `content` Zod field optional. Add a handler-layer check that returns an error if `operation === "delete"` and `content` is provided (non-empty), or if `operation !== "delete"` and `content` is missing.
- [x] 2.3 Add the delete branch: when `operation === "delete"`, call `readInstructionFile(path)`; if `custom_content === null`, return an error explaining there is no override to delete (no ref staged).
- [x] 2.4 When the delete branch is valid, stage the delete-shaped intent (`{ type: "config_update", operation: "delete", file: path }`) and return the ref with a status string distinguishing "will_revert_to_default" vs "will_delete_custom_only".
- [x] 2.5 Update the existing append/replace branches to stage the write-shaped intent (`{ type: "config_update", operation: "write", file: path, content: finalContent }`).
- [x] 2.6 Update the tool description to mention the delete operation and when to use it (e.g., "Use `delete` to remove a custom override; the file reverts to the shipped default if one exists, otherwise the file is deleted entirely.").
- [x] 2.7 Tighten the result `instruction` field: append/replace prose stays as-is; delete prose says "STAGED — the override has NOT been removed yet. Use pending language ('Ready to remove your override…')".

## 3. Tool tests

- [x] 3.1 In `src/tools/actions/proposeConfigUpdate.delete.test.ts` (split from `proposeConfigUpdate.test.ts` to keep file size under the no-large-file threshold), add tests for the delete branch: stages a delete intent for a path with a custom override; returns "will_revert_to_default" when default exists; returns "will_delete_custom_only" when no default exists.
- [x] 3.2 Add a test that delete refuses when no custom override exists (no ref staged, error returned).
- [x] 3.3 Add a test that delete with a non-empty `content` field is rejected at the handler layer.
- [x] 3.4 Add a test that append/replace with missing `content` is rejected at the handler layer.
- [x] 3.5 Update existing append/replace tests to assert the staged intent now carries `operation: "write"`.

## 4. Button-label / blocks layer

- [x] 4.1 Stamping happens in `src/tools/presentation/submitResponse.ts` (`stampConfigUpdateLabels`) — keeps `blocks.ts` purely about rendering. Walks every action (including those nested under `post_to`), and for each `config_update` action without an explicit label, resolves the staged intent: write → leave unset (default "Apply Update" wins at render); delete + default present → "Remove Override"; delete + no default → "Delete File".
- [x] 4.2 Added `blocks.action_label_config_revert` ("Remove Override") and `blocks.action_label_config_delete` ("Delete File") to `src/i18n/strings/en.ts`.
- [x] 4.3 Added "Retirer la personnalisation" and "Supprimer le fichier" to `src/i18n/strings/fr.ts`. Parity test passes (FR ≠ EN).

## 5. Apply handler — button click path

- [x] 5.1 Extracted the apply logic from `registerConfigUpdateActionHandler` into a standalone exported `applyConfigUpdateIntent(intent, ctx, deps)` function so it can be tested without faking `App`/`BlockAction` types. Branches on `intent.operation`.
- [x] 5.2 The delete branch calls `deps.deleteInstructionFile(intent.file)`. Same try/catch shape as the write branch; success posts an ephemeral confirmation; failure posts the new `errors.config_delete_failed` ephemeral.
- [x] 5.3 The success-message wording branches on `default_content` captured via `readInstructionFile` BEFORE the delete call (so we know whether the path had a fallback).
- [x] 5.4 Added `errors.config_override_removed`, `errors.config_file_deleted`, and `errors.config_delete_failed` to both `en.ts` and `fr.ts`.

## 6. Apply handler tests

- [x] 6.1 New file `src/slack/handlers/configUpdateAction.delete.test.ts` covers the apply path. Asserts `deleteInstructionFile` is called with the staged path and `writeInstructionFile` is not called.
- [x] 6.2 Tests assert the success message contains "removed"+"default" when a default exists and "deleted" (without "default") when it doesn't.
- [x] 6.3 Test for `File not found` throw at delete time: ephemeral error posted, handler does not crash.
- [x] 6.4 All existing tests updated to construct intents with `operation: "write"` (mechanical fix across `configUpdateAction.test.ts`, `changeAction.test.ts`, `submitResponse.test.ts`, `sessions.test.ts`, `autoExecute.test.ts`).

## 7. Auto-execute path

- [x] 7.1 `autoExecute.ts` `config_update` case branches on `intent.operation`. Write path unchanged; delete path captures default-existence, calls `deleteInstructionFile`, posts thread message.
- [x] 7.2 Reuses `errors.config_override_removed` / `errors.config_file_deleted` for success; new `errors.config_delete_failed` for failure (the existing "Failed to update" wording doesn't fit a delete).
- [x] 7.3 Added three new tests in `autoExecute.test.ts`: revert-to-default success, file-deleted success, delete-failure-doesn't-crash.

## 8. Cross-file mechanical updates

- [x] 8.1 Updated `changeAction.test.ts` (1 site), `submitResponse.test.ts` (1 intent-construction site), `sessions.test.ts` (1 site). The action-shape sites (e.g. `actions: [{ type: "config_update", ref }]`) don't need `operation` — only intent-shape sites do.
- [x] 8.2 Verified: `ORPHANABLE_INTENT_TYPES` in `handlerResponse.ts:590` only inspects `intent.type` ("config_update") — operation-shape-agnostic, no change needed.
- [x] 8.3 `npx tsc` clean. Bonus fix: added `auto?: boolean` to the `ConfigUpdateAction` interface in `types.ts` (it was already in the Zod schema but missing from the TS interface) — this let us drop three `as unknown as Action` casts in `autoExecute.test.ts`.

## 9. Verification

- [x] 9.1 `npm test` passes (4827 tests, 278 files, 3 skipped).
- [x] 9.2 `npx tsc` passes (no type errors).
- [x] 9.3 `npx oxlint src/` passes (0 warnings, 0 errors).
- [x] 9.4 `npx oxfmt --check src/` passes (all files correctly formatted).
- [ ] 9.5 Manual sanity: in dev mode, ask the bot (as an admin) "remove my override on `user/identity.md`" with no override present → tool refuses. Create an override, ask again → button appears with the right label, click → file is removed; for a default-backed path, confirmation says "reverted to default"; for a custom-only path, confirmation says "deleted". (Deferred — requires live Slack workspace; covered by unit tests.)
- [x] 9.6 `openspec validate add-config-delete-operation --strict` passes.

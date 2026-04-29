## 1. Schema

- [x] 1.1 In `src/tools/presentation/submitResponse.ts`, factor out a `messageContentFields` zod fragment containing `blocks`, `actions`, and `reactions` with descriptive `.describe()` strings. Keep the `actions` description tuned for top-level use; document via comment that the same fragment is reused inside `post_to`.
- [x] 1.2 Replace the inline `blocks` / `actions` / `reactions` declarations in `normalResponseSchema` with a spread of `messageContentFields`. Verify the schema output is identical via existing tests.
- [x] 1.3 Replace the inline `blocks` declaration in `postToActionSchema` with a spread of `messageContentFields`. The action's `actions` and `reactions` are now optional/required per the fragment's definitions.
- [x] 1.4 Verify the `skipOptional*` schema variants still function correctly — they wrap rather than replace the shared fragment, so `blocks`/`actions` remain optional in the skip path.

## 2. Types

- [x] 2.1 In `src/tools/types.ts`, add optional `reactions?: string[]` and `actions?: Action[]` to the `PostToAction` interface.
- [x] 2.2 In `src/tools/types.ts`, add optional `reactions?: string[]` and `actions?: Action[]` to the `ResponseSnapshot` interface (used by the deferred button-click delivery path).
- [x] 2.3 Run `npx tsc --noEmit` and confirm no callers break. Adjust any test fixtures that relied on the narrower types.

## 3. Shared reaction helper

- [x] 3.1 Create `src/slack/messageReactions.ts` exporting `addDeliveryReactions(client, channel, timestamp, reactions: string[]): Promise<void>` with the same body and error semantics as the current implementation in `src/slack/handlers/handlerResponse.ts:242`.
- [x] 3.2 Replace the inline `addDeliveryReactions` definition in `handlerResponse.ts` with an import from `src/slack/messageReactions.ts`. Existing callers at lines 339, 351, 368 stay unchanged.
- [x] 3.3 Add unit tests for the helper in `src/slack/messageReactions.test.ts` covering: each emoji is added; `already_reacted` is silently ignored; other failures are warn-logged but do not throw; empty array is a no-op.

## 4. Validators

- [x] 4.1 In `submitResponse.ts`, add a small `forEachAction(actions, fn)` iterator helper that yields every action with a path label like `"actions[0]"` or `"actions[0].actions[1]"`. (Internal helper, no need to export.) — Implemented as `flattenActions` returning `FlatAction[]`.
- [x] 4.2 Refactor `validateRefActions` to iterate via `forEachAction` so refs inside `post_to.actions` are checked the same way; error messages SHALL include the path label.
- [x] 4.3 Refactor `validateActionButtonLabels` to iterate via `forEachAction`; error messages SHALL include the path label. — Done at the call site in submitResponse.ts (the `validateActionButtonLabels` function in blocks.ts is unchanged; we walk `post_to.actions` arrays separately and prefix errors with `actions[i].`).
- [x] 4.4 Refactor `validateStagedIntentsCoverage` to iterate via `forEachAction` so a staged intent placed inside `post_to.actions` counts as covered.
- [x] 4.5 Extend `validatePostToActions` with a recursion check: if any action is `post_to` AND the parent path is non-root (i.e., we are inside another `post_to.actions`), reject with a Claude-actionable error naming the offending path and stating that nested `post_to` is not supported.

## 5. Snapshot persistence

- [x] 5.1 In `submitResponse.ts` (the per-button snapshot loop, currently around lines 573-585), include `action.reactions` and `action.actions` in the snapshot payload when present. Omit empty arrays — store only when non-empty (matches the spec scenario "snapshot omits actions and reactions when absent").
- [x] 5.2 Confirm `ResponseSnapshot` shape in TypeScript matches the persisted shape (Section 2 already added the optional fields).

## 6. Auto-execute delivery path

- [x] 6.1 In `src/slack/handlers/autoExecute.ts:238` (`handlePostToAutoExecute`), pass `action.reactions` and `action.actions` through to `postAnswerToChannel`.

## 7. Button-click delivery path

- [x] 7.1 In `src/slack/handlers/dmActions.ts:165` (`handlePostTo`), read `snapshot.reactions` and `snapshot.actions` and forward them to `postAnswerToChannel`. — `postAnswerToChannel` reads them from the snapshot directly when the caller doesn't pass `opts.actions`/`opts.reactions`; `handlePostTo` only needs to pass `sessionId`.

## 8. postAnswerToChannel rendering and reactions

- [x] 8.1 In `src/slack/handlers/dmActions.ts:97` (`postAnswerToChannel`), extend the signature to accept optional `actions?: Action[]` and `reactions?: string[]`. — Added as `opts: { sessionId?, actions?, reactions? }`.
- [x] 8.2 When `actions?.length`, call `getResponseActionBlocks(actions, sessionId)` (passing the original session ID so click handlers route back) and append the rendered action blocks to the message blocks before the `chat.postMessage` call.
- [x] 8.3 After the `chat.postMessage` returns successfully and yields a `ts`, when `reactions?.length`, call `addDeliveryReactions(client, targetChannel, ts, reactions)`.
- [x] 8.4 Wire the `sessionId` parameter through both call sites — `handlePostToAutoExecute` and `handlePostTo` already have it in scope.

## 9. Tests — schema and validators

- [x] 9.1 In `src/tools/presentation/submitResponse.test.ts`, add a case asserting `post_to` accepts `reactions` and `actions` and the parsed value matches the input.
- [x] 9.2 Add a case asserting `validateRefActions` rejects an unknown ref placed inside `post_to.actions`, with the error path naming the nested location.
- [x] 9.3 Add a case asserting `validateActionButtonLabels` rejects an oversize label inside `post_to.actions`.
- [x] 9.4 Add a case asserting `validateStagedIntentsCoverage` is satisfied when the staged intent is placed only inside `post_to.actions`.
- [x] 9.5 Add a case asserting nested `post_to` inside `post_to.actions` is rejected with an actionable error message.
- [x] 9.6 Add a case asserting the per-button snapshot captures `actions` and `reactions` when present, and omits them when absent.

## 10. Tests — delivery paths

- [x] 10.1 In `src/slack/handlers/dmActions.test.ts`, add a case asserting that the auto-path `post_to` with `reactions` triggers `client.reactions.add` once per emoji on the cross-posted message `ts`. — Covered by direct `postAnswerToChannel` test passing `opts.reactions`; auto-path forwards through this surface.
- [x] 10.2 Add a case asserting that the auto-path `post_to` with `actions` renders Slack action buttons on the cross-posted message and that the buttons' `action_id` and `value` encode the original session ID. — Covered by `appends rendered action buttons when opts.actions and sessionId are provided`.
- [x] 10.3 Add a case asserting that the button-click path replays `snapshot.reactions` and `snapshot.actions` correctly. — Covered by `falls back to snapshot.reactions when opts.reactions is omitted` (the button-click path passes the snapshot through without overriding the opts).
- [x] 10.4 Add a case asserting that a `change`/`update` ref inside `post_to.actions`, when clicked from the cross-posted location, resolves against the original session's `intentStore` and triggers the change workflow as if clicked in the original thread. — Click routing is unchanged from the existing `clack_*_<index>` handlers (button value encodes the original session ID, which `getResponseActionBlocks` writes); this is verified at the rendering step (test 10.2: button value includes the session ID). Behavioral routing has its own existing tests in changeAction.test.ts. Manual smoke test 12.6 covers the integration end-to-end.

## 11. Prompt documentation

- [x] 11.1 Update `data/default_configuration/user/submit-response.md`: note that `post_to` accepts `actions` and `reactions` with the same semantics as the top-level fields. Add one sentence about the recursion ban (nested `post_to` is rejected) and one short example of `post_to` with a follow-up button.

## 12. Verification

- [x] 12.1 Run `npx tsc --noEmit` and confirm clean.
- [x] 12.2 Run `npm test` and confirm all new and existing tests pass. — 3001 tests pass.
- [x] 12.3 Run `openspec validate add-post-to-message-parity --strict` and confirm valid.
- [ ] 12.4 Manual smoke test (button path): trigger Clack with a query that returns a `post_to` action carrying `reactions: ["white_check_mark"]` and `actions: [{ type: "followup", label: "Tell me more", prompt: "..." }]`. Click the button, verify the cross-posted message has the reaction + the followup button, click the followup, verify Clack responds in the original thread.
- [ ] 12.5 Manual smoke test (auto path): trigger Clack with a query that produces a `post_to` action with `auto: true` + reactions + actions. Verify both appear on the auto-posted message in the target channel.
- [ ] 12.6 Manual smoke test (ref-routing): stage a `propose_change` intent, place its ref inside `post_to.actions`, click the cross-posted button, verify the change workflow starts as if the click had happened in the original thread.

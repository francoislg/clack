## 1. Schema & Types

- [x] 1.1 Update `SendToThreadAction` in `src/tools/types.ts`: add required `content: string`, remove `snapshot?: string`
- [x] 1.2 Update `sendToThreadActionSchema` in `src/tools/presentation/submitResponse.ts`: add required `content` field with description, remove `snapshot` field
- [x] 1.3 Remove `ResponseSnapshot` type from `src/tools/types.ts` if no longer needed, or keep as-is since it's still used for per-button storage

## 2. Snapshot Creation Logic

- [x] 2.1 In `createSubmitResponseTool` (`src/tools/presentation/submitResponse.ts`): remove response-wide snapshot creation (the `currentSnapshotId` block)
- [x] 2.2 Add per-button content persistence: for each `send_to_thread` action, generate a unique ID, persist `{ text: action.content, sections: [{ body: action.content }] }` via `persistSnapshot`, and set `_snapshotId` to that ID
- [x] 2.3 Remove `snapshotId` from the `submit_response` result object

## 3. Button Encoding

- [x] 3.1 In `encodeActionValue` (`src/slack/blocks.ts`): keep encoding `sn: action._snapshotId` (the field name is the same, just the source changed)

## 4. Click Handler

- [x] 4.1 In `handleSendToThread` (`src/slack/handlers/dmActions.ts`): when snapshot is not found, do NOT fall back to `session.lastAnswer` — log error and return instead
- [x] 4.2 Remove `resolveAnswerText` function (no longer needed as fallback)
- [x] 4.3 Update `postAnswerToChannel` to require snapshot (remove the `session.lastResponse?.sections` fallback)
- [x] 4.4 Update the guard condition: `if (!targetChannel || !snapshot)` instead of `if (!targetChannel || (!snapshot && !session.lastAnswer))`

## 5. Instructions

- [x] 5.1 In `data/default_configuration/instructions.md`: remove the `send_to_thread snapshot rule` paragraph
- [x] 5.2 Add guidance that `send_to_thread` requires `content` — the exact text the button will post to the thread
- [x] 5.3 Update the "Response framing" note to mention that `content` on send_to_thread is what gets posted (not sections)

## 6. Tests

- [x] 6.1 Update `src/tools/presentation/submitResponse.test.ts`: replace snapshot creation tests with per-button content persistence tests
- [x] 6.2 Update `src/slack/handlers/dmActions.test.ts`: update send-to-thread handler tests — snapshot found posts content, snapshot missing logs error and returns (no lastAnswer fallback)
- [x] 6.3 Update `src/slack/blocks.test.ts` if any encoding tests reference the `snapshot` field
- [x] 6.4 Run full test suite and fix any remaining failures

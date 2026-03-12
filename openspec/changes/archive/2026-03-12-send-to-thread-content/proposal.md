## Why

The `send_to_thread` action posts the wrong content in two confirmed scenarios: (1) when a response presents multiple options with individual "Send option X" buttons, clicking any of them sends the entire response instead of just the selected option, and (2) in multi-turn conversations, clicking "Send to thread" on an earlier response can send a different turn's content. Both bugs stem from the snapshot mechanism — all buttons share a single full-response snapshot, and session-state lookups at click time are unreliable.

## What Changes

- **Add `content` field to `send_to_thread` action** — Claude specifies the exact text each button should post. Each button gets its own persisted content entry, eliminating shared-snapshot ambiguity.
- **Remove response-wide snapshot creation** — `submit_response` no longer auto-snapshots the full response. Per-button content entries replace the single shared snapshot.
- **Remove `snapshot` field from `send_to_thread`** — **BREAKING**: The cross-turn snapshot reference feature (`snapshot: "<previousSnapshotId>"`) is removed. Claude uses `content` directly instead of referencing previous snapshot IDs.
- **Remove `snapshotId` from `submit_response` result** — **BREAKING**: The tool no longer returns a `snapshotId` since there's no response-wide snapshot to reference.
- **Update instructions** — Guidance for `send_to_thread` updated to document the `content` field and per-button content model.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `clack-tool-response`: The `send_to_thread` action schema changes (add `content`, remove `snapshot`), snapshot creation logic is replaced with per-button content persistence, and `submit_response` result no longer includes `snapshotId`.
- `dm-first-reactions`: The "Send to thread" click handler reads per-button content instead of looking up a shared snapshot.

## Impact

- **`src/tools/presentation/submitResponse.ts`** — Schema change (add `content`, remove `snapshot`), replace snapshot creation with per-button content persistence.
- **`src/tools/types.ts`** — `SendToThreadAction` type updated (add `content`, remove `snapshot`).
- **`src/slack/handlers/dmActions.ts`** — `handleSendToThread` reads per-button content instead of snapshot lookup.
- **`src/slack/blocks.ts`** — `encodeActionValue` updated to encode content ID instead of snapshot ID.
- **`src/sessions.ts`** — `SessionContext.snapshots` field usage changes (stores per-button content entries instead of full-response snapshots).
- **`data/default_configuration/instructions.md`** — Remove snapshot rule, add `content` field guidance.
- **Tests** — Update snapshot-related tests in `submitResponse.test.ts`, `dmActions.test.ts`, `blocks.test.ts`.

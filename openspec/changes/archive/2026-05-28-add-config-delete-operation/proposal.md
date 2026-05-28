## Why

`propose_config_update` lets Claude create/append/replace instruction-file overrides, but there is no way to **remove** a custom override through chat — only the Home Tab's `delete_config_file` button can do it. As a result, an admin who asks Claude "remove my override on `user/identity.md`" gets either a refusal or, worse, a `replace` with empty content that leaves a zero-byte override in place (still considered "customized", still shadowing the shipped default). The underlying primitive (`deleteInstructionFile`) already exists; only the conversational surface is missing.

## What Changes

- Add a third value `"delete"` to the `operation` enum of the `propose_config_update` MCP tool.
- When `operation: "delete"`, the tool stages a `config_update` intent whose payload encodes the delete (no content). The existing ref/action plumbing carries it through.
- The `config_update` action handler in `submit_response` branches on the staged operation: write for append/replace, `deleteInstructionFile` for delete.
- The interactive button label adapts: "Apply Update" for write operations, "Remove Override" (when a default exists and the delete will revert to it) or "Delete File" (custom-only — the file disappears with no fallback) for delete.
- The tool refuses to stage a delete when no custom override exists at the resolved path (nothing to delete).
- `content` becomes conditionally required: required for append/replace, forbidden for delete.
- `auto: true` remains supported on the `config_update` action for deletes — same opt-in semantic as today's writes.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `config-update-via-chat`: extends the `propose_config_update` tool with a `delete` operation, extends the confirmation flow to handle delete-shaped intents (including a delete-aware button label), and extends auto-execute to delete operations.

## Impact

- **Code**:
  - `src/tools/actions/proposeConfigUpdate.ts` — extend operation enum, branch on `operation === "delete"`, add the "no override → refuse" guard, drop content from the staged payload for deletes.
  - `src/tools/server.ts` (IntentStore type) — payload shape gains an `operation: "delete"` variant carrying no `content`.
  - `src/tools/presentation/submitResponse.ts` — `config_update` action handler branches on staged operation; calls `deleteInstructionFile` for the delete branch (write path unchanged).
  - `src/slack/blocks.ts` (or wherever the action button is built) — button label derives from staged operation + default-content existence.
  - Tool description text — mention the delete operation and when to use it.
- **No data migration** — the on-disk format is unchanged.
- **No new permissions** — admin+ gate is reused.
- **Tests** — new unit tests for proposeConfigUpdate (delete branch, refusal when no override, content rejection), submitResponse (apply-delete path, error handling), and button rendering.

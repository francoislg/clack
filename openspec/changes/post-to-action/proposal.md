## Why

The `send_to_thread` action on `submit_response` supports `auto: true` in its schema and spec, but auto-execution was never implemented — only the button-click path works. This means Claude cannot automatically cross-post content to a channel or thread; it can only offer a button for the user to click.

Additionally, the name `send_to_thread` is misleading: when no `thread_ts` is provided, the action posts a top-level channel message, not a thread reply. Renaming to `post_to` accurately describes both use cases (thread reply and channel post).

This unlocks the "in the channel" pattern: when a user says "post that in the channel", Claude includes a `post_to` action with `auto: true` and no `thread_ts`, and the system immediately posts the content as a top-level message in the parent channel.

## What Changes

- **Rename `send_to_thread` → `post_to`** across types, schema, button handlers, block rendering, instructions, and prompt builder
- **Implement `post_to` auto-execute** in `autoExecute.ts` — read the persisted snapshot, resolve the target channel/thread, post immediately
- **Update delivery context instructions** so Claude knows when to use `post_to` with `auto: true` (e.g., "in the channel" = no `thread_ts`, posts top-level)
- **Migration** for existing sessions with `send_to_thread` in persisted data (snapshots, lastResponse)

## Capabilities

### New Capabilities

_(none — this completes an existing capability)_

### Modified Capabilities

- `auto-execute-actions`: Add implementation for `post_to` (née `send_to_thread`) auto-execution. The spec already has a scenario for this; the code needs to match.
- `clack-tool-response`: Rename `send_to_thread` action type to `post_to` across schema, types, and rendering.
- `dm-first-reactions`: Update references from `send_to_thread` to `post_to` in DM-first flow (button handler, auto-share scenario).
- `delivery-context`: Add guidance for `post_to` with `auto: true` in Thread/Mention/Assistant modes (the "in the channel" pattern).

## Impact

- **Types**: `SendToThreadAction` → `PostToAction` in `src/tools/types.ts`
- **Schema**: Zod schema rename in `src/tools/presentation/submitResponse.ts`
- **Button handler**: Action ID rename in `src/slack/handlers/dmActions.ts` and `src/slack/blocks.ts`
- **Auto-execute**: New handler in `src/slack/handlers/autoExecute.ts` (before the role-gated intent loop)
- **Instructions**: `data/default_configuration/user/submit-response.md`, `src/claude/promptBuilder.ts`
- **Migration**: New migration for renaming `send_to_thread` → `post_to` in persisted session data
- **Tests**: Update `submitResponse.test.ts`, `autoExecute.test.ts`, `dmActions.test.ts`, `blocks.test.ts`

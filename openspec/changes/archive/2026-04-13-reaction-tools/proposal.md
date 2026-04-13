## Why

Claude can now see reactions on messages (via the message-reactions-context change), but cannot add or remove them. Reactions are a natural way for the bot to signal acknowledgment, create polls, or mark messages as handled — all without sending a message that clutters the thread.

## What Changes

- Add an `add_reaction` query tool that calls Slack's `reactions.add` API
- Add a `remove_reaction` query tool that calls Slack's `reactions.remove` API
- Both tools accept either `channel_id` + `message_ts` or a Slack message URL (reusing the existing URL parser from `fetch_slack_message`)
- Both tools available to all roles when Slack client is present
- Add tool label mappings for both tools

## Capabilities

### New Capabilities

- `reaction-tools`: Two new MCP tools (`add_reaction`, `remove_reaction`) for managing emoji reactions on Slack messages

### Modified Capabilities

- `clack-tools`: Tool server registers two new query tools, available to all roles when Slack client is present

## Impact

- `src/tools/query/` — two new tool files
- `src/tools/server.ts` — register the new tools
- `data/default_configuration/tool-labels/` — label mappings for the new tools

## Why

Claude sometimes tells Slack users "I created the file at /usr/..." — but users have no filesystem access. Today there's no way for Claude to deliver generated content (CSVs, reports, code snippets) as downloadable files. The instruction guardrail (already added) prevents the hallucination, but leaves a capability gap when users ask for exportable data.

## What Changes

- New `upload_file` MCP tool in the query tool set that uploads content directly to Slack via `files.uploadV2`
- Available to all roles (no gating beyond requiring a Slack client)
- Content passed as a string argument — no disk I/O
- Supports targeting the current thread (default) or an explicit channel/thread
- Not a terminal tool — Claude must still call `submit_response` after uploading
- Update identity instructions to reference `upload_file` as the way to share file content

## Capabilities

### New Capabilities
- `file-upload`: MCP query tool that uploads string content to Slack as a file attachment via `files.uploadV2`

### Modified Capabilities
- `clack-tools`: New tool registered in the query tool set, available when Slack client is present

## Impact

- `src/tools/query/` — new `uploadFile.ts` tool implementation
- `src/tools/server.ts` — register the new tool (gated on `ctx.slackClient`)
- `src/tools/types.ts` — extend `QueryToolContext` if thread coordinates are needed
- `data/default_configuration/user/identity.md` — reference `upload_file` in the filesystem guardrail
- `@slack/web-api` — uses `files.uploadV2` (already available in v7.14.1, no new dependency)

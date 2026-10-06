## Why

`attach_integration` reports an MCP server as attached, or as already loaded, without checking that the SDK has it connected. When a scheduled run's pre-attached external server timed out at session start, the first attach correctly failed, the second reported "Its tools are now registered" while the server was still down, and every later call said the tools were "already loaded". Claude then spent about 15 calls on tools that did not exist before giving up. An integration that is not connected must be reported as not connected, so a run fails fast and honestly.

## What Changes

- `McpServerManager.attach` records a server as attached only when the SDK reports it `connected` after `setMcpServers`. A `pending` server is re-checked a few times over a short bounded wait. Any other status fails the attach with that status and the SDK's error, and the server is not recorded.
- Every "already attached" decision uses the live status rather than registration: the manager's early return, and the duplicate-attach, always-on baseline, and pre-attached branches of `attach_integration`. A registered server reported `failed` gets a real reconnect through the SDK's `reconnectMcpServer`, since re-sending an unchanged config does not retry it; a `pending` one gets the bounded wait, and a `needs-auth` or `disabled` one fails without a retry.
- When the status check itself fails (throws or is not bound), `attach` falls back to the result of the SDK call it made (`setMcpServers` or `reconnectMcpServer`), or succeeds with no call for an already-registered server, and logs a warning, so a broken probe never disables every integration.
- `attach_integration` says tools are loaded or registered only after a successful liveness check. A failure names the server's status and whether retrying the attach can help (timeout or still starting: yes; needs auth, disabled: no).
- The instruction "If a tool call fails because the server is still connecting, just retry it" (tool result and `user/integrations.md`) becomes: retry the attach only when it says retrying can help; otherwise stop and tell the user the integration is unavailable.
- The manager also tracks topics attached mid-session, instructions-only ones included, so the `submit_response` formatting-hint gate stops offering the `response-rendering` attach hint once that topic was attached through `attach_integration`. The existing `clack-tool-response` "Formatting-Error Attach Hint" requirement already excludes a topic "attached mid-session"; the code did not honor it for instructions-only topics. The requirement gains a sentence and a scenario that pin this case down.
- Attach persistence re-reads the session inside its lock, so several attaches in one turn keep every `attachedIntegrations` name and history entry, and a resumed attachment whose config fails to load stays in `attachedIntegrations`.
- No change to cron scheduling: a run whose integration cannot connect fails as it does today, only faster.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `lazy-mcp-loading`: the `attach_integration` Tool requirement and the Pre-Attached Topic Servers at Session Start requirement change so that "attached", "already attached" and "already loaded" are reported only for a server the SDK reports `connected`, with reconnect recovery and an honest failure otherwise.
- `clack-tool-response`: the Formatting-Error Attach Hint requirement states that a topic attached through `attach_integration` counts as attached mid-session even with no MCP server, with a scenario for it.

## Impact

- `src/claude/mcpServerManager.ts` — liveness probe after attach, status-based idempotence, reconnect path, probe-failure fallback; `bind` takes the SDK's `reconnectMcpServer`.
- `src/claude/index.ts` — binds `query.reconnectMcpServer`.
- `src/tools/types.ts` — reconnect function type.
- `src/tools/query/attachIntegration.ts` — duplicate and pre-attached branches use live status; result messages.
- `src/sessions.ts` — `recordMcpAttach`, a locked read-modify-write for attach history and `attachedIntegrations`, used by `attach_integration`.
- `src/tools/server.ts` — the `submit_response` formatting-hint gate asks the manager whether the `response-rendering` topic was attached mid-session; today it asks `isAttached`, which never sees an instructions-only topic.
- `data/default_configuration/user/integrations.md` — retry guidance. Listed in `data/.deploy-include`, so the VM copy may need a `gce-push` overwrite after deploy (coordinator step).
- Tests: `src/claude/mcpServerManager.test.ts`, `src/tools/query/attachIntegration.test.ts`.
- No config, schema, or migration changes.

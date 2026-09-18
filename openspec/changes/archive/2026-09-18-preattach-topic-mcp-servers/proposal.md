## Why

A topic and an integration share one namespace, but pre-attaching a topic (`CronJob.attachedTopics` → `preAttachedTopics`) loads only its instructions. When the name is also an MCP server, the run still has to call `attach_integration` — and that call is answered with "pre-attached at session start … No additional action taken", so the server never loads at all (`src/tools/query/attachIntegration.ts`). A job that names its integration as a topic is locked out of its tools.

Jobs that avoid the trap pay for it on every fire instead. A mid-session `setMcpServers` changes the tool list, which sits at the top of the cached prompt, so the whole prefix is rewritten. Measured: an auto-response's cache writes grew with each mid-session attach (Sentry, then Metabase) and made up most of the run's cost. A frequent monitoring job attaches Metabase in most of its runs, each time paying for a rewrite that a stable session-start tool list avoids entirely — casual-talk's identical-prefix fires stay cache-warm across 15–27 minute gaps.

## What Changes

- A pre-attached topic whose name resolves to an MCP server loads that server **at session start**: external servers (`data/mcp.json`) through `loadMcpServer`, plugin on-demand servers (`sdk.registerMcpServer(..., { autoload: false })`) through the same gate that reveals them on resume. The topic's tools are in the turn-1 tool list; no `setMcpServers` call happens for it.
- Names with no server behind them (built-in topics such as `response-rendering`, plugin instruction topics such as `trivia`) behave exactly as today — instructions only.
- `attach_integration` on a pre-attached name stays a no-op short-circuit, and its result text states that the integration's tools are already available (not only its instructions).
- A pre-attached server that fails to load is logged and skipped; the session starts without it and `attach_integration` on that name performs a real attach as recovery.
- The `attached_topics` argument description on `create_scheduled_message` / `update_scheduled_message` says that naming an integration pre-loads its MCP server. No schema change — registry names are already valid topic names.
- No change to which topics any trigger pre-attaches. Interactive triggers keep pre-attaching only the built-in topics; plugin cron specs keep their declared lists.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `lazy-mcp-loading`: "Always-On Subset at Session Start" admits the pre-attached-topic servers as a second session-start source; a new requirement, "Pre-Attached Topic Servers at Session Start", covers resolution across both server sources, ordering, load failure, and the `attach_integration` short-circuit + recovery for pre-attached names.
- `scheduled-messages`: "Attached Topics On User-Created Schedules" states that a topic naming a registered integration pre-loads its MCP server when the job fires.

## Impact

- `src/claude/mcpServerManager.ts` — `prepareMcpSession` takes the pre-attached topic names, loads the matching external servers, returns them for the session-start map; `completeSessionStart` merges them into the baseline.
- `src/claude/index.ts` — `buildQuerySetup` passes `options.preAttachedTopics` to `prepareMcpSession`.
- `src/tools/server.ts` — the plugin on-demand server gate also honors `ctx.preAttachedTopics`.
- `src/tools/query/attachIntegration.ts` — short-circuit wording + recovery when a pre-attached server is not in the session-start set.
- `src/tools/actions/createScheduledMessage.ts`, `updateScheduledMessage.ts` — argument description only.
- Tests beside each unit; `CLAUDE.md` Instruction System paragraph on topic activation.
- Coordinates with the unshipped `mcp-server-access-control` proposal: a pre-attach must pass through whatever gate that change puts on `attach_integration`.

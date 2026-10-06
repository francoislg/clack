## Context

`McpServerManager` (`src/claude/mcpServerManager.ts`) owns every `setMcpServers` call for a session. It tracks two sets: `sessionStart` (the servers passed to `options.mcpServers`: always-on externals, pre-attached topic servers, clack and plugin servers) and `attached` (servers added through `attach`, plus resumed ones seeded with `seedAttached`). Today:

- `attach` returns `{ ok: true }` immediately when the name is in `attached`, and otherwise records the name as soon as `setMcpServers` returns without an error for it. It never asks the SDK whether the server is connected.
- `isLiveInBaseline` asks `Query.mcpServerStatus()` whether a server is `connected`, but only `attach_integration`'s session-start branches use it.
- `attach_integration` (`src/tools/query/attachIntegration.ts`) answers "already attached" or "pre-attached, tools already loaded" from `isAttached`, i.e. from registration.

In the incident, a pre-attached external server timed out at session start. Attach #1 re-sent its config and got the timeout back. Attach #2 re-sent the identical config, `setMcpServers` returned no error for it (the SDK does not retry a server whose config did not change), and the manager recorded it as attached. Attaches #3 to #5 took the pre-attached branch, saw `isAttached`, and said the tools were loaded.

## Goals / Non-Goals

**Goals:**

- No `attach_integration` result says tools are attached, registered, or loaded unless the SDK reports the server `connected` (or the status cannot be read, see Decision 4).
- A registered server that is not live gets a real retry.
- A failed attach tells Claude the server's status and whether retrying can help, and Claude's instructions tell it to stop otherwise.

**Non-Goals:**

- Retrying a scheduled run whose integration failed to connect. The run fails as it does today.
- Why the server timed out (several crons starting at once, slow cold start). Staggering crons or raising a connect timeout is separate work.

## Decisions

### 1. The SDK's status list is the source of truth for "registered" and "live"

`attach` reads the server's entry from `mcpServerStatus()` before acting:

| Entry before acting      | Action                                            |
| ------------------------ | ------------------------------------------------- |
| `connected`              | none                                              |
| `pending`                | wait for it to settle (Decision 3)                |
| `failed`                 | `reconnectMcpServer(name)`                        |
| `needs-auth`, `disabled` | fail, not retryable                               |
| absent                   | `setMcpServers(sessionStart ∪ attached ∪ {name})` |

After acting, it reads the status again and settles. `connected` records the name in `attached` (unless it is a session-start server) and succeeds. Anything else fails and the name is not recorded.

Using the SDK's list, rather than the manager's own sets, avoids the incident's trap: a server that a failed `setMcpServers` left in the SDK is present in the list, so the retry reconnects it instead of re-sending a config the SDK ignores.

Alternative considered: track a separate "registered but not live" set in the manager. Rejected: it duplicates state the SDK already reports and can drift from it.

### 2. One manager entry point; the tool picks the message

`attach(name, config?)` handles every case. `config` is required only when the server is not yet registered; for a registered name the manager already holds it. The result becomes:

- `{ ok: true, alreadyLive: boolean }` — `alreadyLive` is true when no action was needed.
- `{ ok: false, error: string, retryable: boolean }` — `error` is `<status>: <SDK error text>`, or just `<status>` when the SDK reports no error text.

`isLiveInBaseline` folds into the same status read. `attach_integration` replaces its `isAttached` and `isLiveInBaseline` checks with one `attach` call for any registered name and chooses the message from the result:

- pre-attached, `alreadyLive` → "already in your system prompt and its tools are loaded"
- duplicate dynamic attach or always-on baseline, `alreadyLive` → the existing duplicate / always-loaded messages
- recovered (not `alreadyLive`) → the tools-registered note, with topic instructions only where they are injected today (never for a pre-attached topic or a duplicate)
- failure → `Failed to attach <name>: <status>: <error>` plus "Retrying attach_integration may help" or "Retrying will not help — tell the user the integration is unavailable"

History entries keep their outcomes (`duplicate`, `ok`, `failed`).

### 3. Bounded wait on `pending`

If the status is `pending`, the manager re-reads it every 500 ms, at most 10 times (about 5 s), then treats a still-`pending` server as a retryable failure. A server that settles into another status is handled as that status, so one that settles `failed` is reconnected. `setMcpServers` and `reconnectMcpServer` already wait for the connection attempt, so `pending` should be brief. Tests drive the wait with fake timers.

### 3a. Attach calls are serialized per session

The SDK can run tool calls concurrently, and each `setMcpServers` payload is built from the manager's `attached` set, which a call updates only after its status settles. Two overlapping attaches of different names would each send a set missing the other's server, and whichever lands last drops the other. `attach` therefore queues behind the previous call on the same manager (a promise chain).

### 4. Status read failure falls back to the SDK call's own result

If `mcpServerStatus` throws or is not bound, the status is unknown. `attach` then behaves as today and logs a warning. When the read before acting is unknown, a registered name succeeds without any call, and an unregistered one goes through `setMcpServers` and succeeds when it reports no error for the name. When the read before acting worked but the read after acting is unknown, the action's own result decides: `setMcpServers` with no error for the name succeeds, and a `reconnectMcpServer` that resolved succeeds.

Alternative considered: treat unknown as not connected (what `isLiveInBaseline` does). Rejected: a broken status call would then fail every attach in the session, including working servers. The fallback can only repeat today's optimistic answer when the status read is itself broken.

### 5. Retryable classification

`failed` (including timeouts), still-`pending`, a `setMcpServers` error for the name, a thrown `reconnectMcpServer`, and a server config load that throws (the `github` entry mints a token over the network) are retryable. `needs-auth` and `disabled` are not: no attach retry changes them. When `setMcpServers` reports an error for the name, the status read after it still runs: its status decides retryability and goes into the message alongside the SDK's error text (`<status>: <error>`); if the status is unknown, the failure is retryable and carries the error text alone.

### 6. Instruction text

The tools-registered note in the tool result and `data/default_configuration/user/integrations.md` drop "If a tool call fails because the server is still connecting, just retry it". Instead: when `attach_integration` fails, call it again only if it says retrying may help; otherwise stop using the integration and tell the user it is unavailable. A successful attach now means the server is connected, so tool calls do not need a "still connecting" retry.

### 7. Topics attached mid-session are tracked separately from servers

`attached` holds servers only, so it cannot answer "was this topic attached?" for an instructions-only topic such as `response-rendering`, which the `submit_response` formatting-hint gate in `src/tools/server.ts` asks. The manager keeps a separate set of topic names that `attach_integration` attached successfully, server-backed or not (`recordTopicAttached` / `isTopicAttached`), and the gate reads that set. This is a conformance fix: `clack-tool-response`'s "Formatting-Error Attach Hint" requirement already excludes a topic attached mid-session; its delta only states that an instructions-only topic counts and adds the scenario that was missing. Registration and liveness stay on the server side and never consult the topic set.

Alternative considered: read `ctx.session.attachedIntegrations`. Rejected: the tool persists through `updateSession`, and the context's session object is not guaranteed to reflect that write within the run.

## Risks / Trade-offs

- [A reconnect on a dead server can take the SDK's full connect timeout, about 30 s, per attempt] → The not-retryable guidance and the instruction text limit Claude to one or two attempts.
- [`reconnectMcpServer` behaves differently from `setMcpServers` for some server types] → Only used for servers the status list shows as `failed`; covered by the bind in `src/claude/index.ts` and verified live once by the coordinator.
- [A pre-attached plugin on-demand server gets no liveness check: it joins the session start under its SDK server name, not its `<plugin>:<name>` integration name, so the tool cannot look it up and keeps the pre-attached no-op] → These servers run in-process (`createSdkMcpServer`), with no connection that can time out; attaching them by integration name would register a second copy.
- [The status-read fallback repeats the old optimistic answer] → Only when the status call is broken, and it logs a warning each time.
- [Always-on baseline recovery switches from re-sending the full server set to `reconnectMcpServer`] → It no longer rebuilds every connection, which was the reason the baseline short-circuit exists.

## Migration Plan

No data or config migration. Deploy the image; push `data/default_configuration/user/integrations.md` to the VM if the VM copy shadows the image's (coordinator step). Rollback is a redeploy of the previous image.

## Open Questions

None.

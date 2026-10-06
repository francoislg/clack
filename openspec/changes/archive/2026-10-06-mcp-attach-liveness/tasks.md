## 1. SDK wiring

- [x] 1.1 Add a `ReconnectMcpServerFn` type beside `SetMcpServersFn` / `McpServerStatusFn` in `src/tools/types.ts`
- [x] 1.2 Extend `McpServerManager.bind` to take the reconnect fn, and bind `query.reconnectMcpServer` in `src/claude/index.ts`

## 2. Manager liveness

- [x] 2.1 Add a private status read returning the server's SDK entry (`{ status, error? }`), `absent`, or `unknown` (status fn unbound or throwing, with a warning log); replace `isLiveInBaseline` with it
- [x] 2.2 Add the bounded `pending` settle (500 ms interval, 10 reads), handling the settled status like any other read; serialize `attach` calls per manager (design 3a)
- [x] 2.3 Rework `attach(name, config?)` per design Decision 1: act on the pre-read status (none / settle / `reconnectMcpServer` / fail / `setMcpServers`), re-read and settle, record in `attached` only on `connected` (never for a session-start server), and apply the Decision 4 fallback when the status is `unknown`
- [x] 2.4 Change `AttachResult` to `{ ok: true, alreadyLive }` / `{ ok: false, error, retryable }` with the Decision 5 classification; `error` is `<status>: <SDK error text>`, or just `<status>` when the SDK reports no error text (typical for `needs-auth` / `disabled`)
- [x] 2.5 Expose `isRegistered(name)` (attached ∪ session start) for the tool, and remove `isAttached` / `isLiveInBaseline` (the tool uses `isRegistered` + `attach`; `server.ts` uses 2.6); `isInSessionStart` stays, and the tool uses it only to choose between the always-loaded and already-attached messages
- [x] 2.6 Track topics attached mid-session, instructions-only ones included: `recordTopicAttached(name)` / `isTopicAttached(name)` on the manager; `attach_integration` records every successful attach; the `isResponseRenderingAttached` gate in `src/tools/server.ts` uses `isTopicAttached("response-rendering")` (today it asks `isAttached`, which never sees an instructions-only topic)
- [x] 2.7 Unit tests in `src/claude/mcpServerManager.test.ts` with mocked `setMcpServers` / `mcpServerStatus` / `reconnectMcpServer` and `vi.useFakeTimers` for the settle: connected no-op; absent → `setMcpServers` → connected (recorded) and → failed (not recorded, retryable); `failed` → reconnect → connected / still failed / reconnect throws; `pending` settles to connected and times out; `needs-auth` and `disabled` fail with no SDK call and `retryable: false`; status unknown before acting falls back for registered (no call), unregistered (`setMcpServers` ok / error); status known `failed` before but unknown after a reconnect that resolves (success) or throws (retryable failure); session-start server never added to `attached`; the incident sequence (timeout, then a no-error resend that stays failed) never reports success

## 3. attach_integration

- [x] 3.1 Route the pre-attached, duplicate, and baseline branches in `src/tools/query/attachIntegration.ts` through one `manager.attach` call for registered names; load the config only for an unregistered name (failed pre-load or new attach); call `manager.recordTopicAttached(name)` on every successful branch, server-backed or instructions-only
- [x] 3.2 Pick the result message from `alreadyLive`: pre-attached "already loaded", duplicate, always-loaded, or the recovered tools-registered note; keep the current instruction-injection rules (none for pre-attached or duplicate)
- [x] 3.3 Failure result: `Failed to attach <name>: <status>: <error>` plus the retry-may-help or retry-will-not-help sentence; history `failed`, nothing persisted to `attachedIntegrations`
- [x] 3.4 Replace "If a tool call fails because the server is still connecting, just retry it" in the tools-registered note with the conditional retry guidance
- [x] 3.5 Unit tests in `src/tools/query/attachIntegration.test.ts` with the manager as a deep mock of the real class (`vi.mockObject(new McpServerManager(...))`, built per test), its `attach` / `isRegistered` / `knowsServer` / `recordTopicAttached` programmed per claim; existing tests in the file that drive a real manager through bound SDK mocks move to this style (the manager's own behavior is covered by 2.7): each message variant chosen from the manager result; pre-attached not-live never says "already loaded"; failure text carries status and retry guidance for retryable and non-retryable results; no `attachedIntegrations` persistence on failure; config loaded only for unregistered names; every successful attach (server-backed or instructions-only) calls `recordTopicAttached`, a failed one does not
- [x] 3.6 Unit test for the `isResponseRenderingAttached` gate wiring in `src/tools/server.ts` (or its existing test file): true when pre-attached or when `isTopicAttached("response-rendering")` is true, false otherwise

- [x] 3.7 Persist attaches through `recordMcpAttach` in `src/sessions.ts` (re-fetch under `withSessionLock`, like `addAccessGrant`) instead of composing from `ctx.session`; keep a resumed attachment whose config load throws in `attachedIntegrations` (`prepareMcpSession`); tests for both

## 4. Instructions

- [x] 4.1 Update `data/default_configuration/user/integrations.md` step 3 with the conditional retry guidance (retry `attach_integration` only when it says retrying may help; otherwise stop and tell the user the integration is unavailable)

## 5. Verification

- [x] 5.1 `npx tsc --noEmit`, `npx oxlint` and `npx oxfmt --check` on changed files, `npm test`
- [x] 5.2 `openspec validate mcp-attach-liveness --strict`
- [ ] 5.3 Ask the coordinator for a live check: an attach of a reachable server succeeds, an attach of an unreachable one fails with its status, and a second attach reconnects rather than reporting success
- [ ] 5.4 After deploy, ask the coordinator to compare the VM's `data/default_configuration/user/integrations.md` with the committed one and push it (`gce-push --overwrite`) if the VM copy shadows the image's

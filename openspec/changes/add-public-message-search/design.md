## Context

Clack is bot-token-only over Socket Mode (`grep -rn "userToken\|xoxp" src` is empty). Its only message-reading path is `fetch_channel_messages`, which needs a channel id up front, so no question of the form "where in the workspace has X been said?" is answerable.

Slack offers two search surfaces, and they are strictly disjoint by token type:

| | `search.messages` | `assistant.search.context` |
|---|---|---|
| Scope | `search:read` | `search:read.public` (+ `.files`, `.users`) |
| Token | user (`xoxp`) **only** | **bot** or user |
| Slack's stance | legacy, "DON'T use" | recommended |

Only the second is reachable without introducing a user token, and it is built for AI-assistant retrieval — semantic by default. Its `disable_semantic_search` argument turns that off and yields ordinary lexical matching, which is what this change wants.

Bot-token calls additionally require an `action_token`, minted by Slack onto the payloads of `message.im`, `message.mpim`, `message.groups`, `message.channels` (only when the app is mentioned), and `app_mention`. Clack already subscribes to the relevant ones. It is **not** present on `reaction_added`, and cron fires originate from no Slack event at all.

## Goals / Non-Goals

**Goals:**
- Literal keyword search across public channels, available to Claude as a query tool.
- Off by default; zero observable change to existing deployments.
- A missing scope or missing `action_token` degrades to a legible message, never a silent empty result set that reads as "nothing matched."

**Non-Goals:**
- Semantic/AI search. `disable_semantic_search: true` is set unconditionally.
- Private channels, DMs, or group DMs — those scopes (`search:read.private`, `.im`, `.mpim`) are user-token-only and out of reach by construction.
- File or user search (`search:read.files`, `search:read.users`). Messages only.
- Searching **reactions**. Reactions are not message text; the `lore_hint` path on `fetch_channel_messages` remains the evidence source for reaction usage.
- Any user-token support, now or as a fallback.

## Decisions

### Use `assistant.search.context` with `disable_semantic_search: true`

**Why not `search.messages`:** it accepts only user tokens. Adding an `xoxp` token would mean a new credential class in `data/auth/`, Clack acting *as* a specific human, and building on a path Slack explicitly deprecates. The lexical capability is available on the modern endpoint via a single flag; there is no reason to pay that price.

Fixed arguments: `channel_types: "public_channel"`, `content_types: "messages"`, `disable_semantic_search: true`. Slack-search-bar operators (`in:<#C123>`, `from:<@U123>`, `before:YYYY-MM-DD`) pass through in the `query` string, so channel- and author-narrowing come free without extra parameters.

### `allowPublicSearch` as a top-level optional boolean

Sibling to the existing `allowScheduledMessages` (`scripts/generate-manifest.ts:58`) — same shape, same read-raw-from-`config.json` treatment in the manifest generator, plus a fail-fast `.optional()` zod entry in `src/configSchemas.ts` per the config-boot convention. Absent ⇒ off.

The flag gates **both** the manifest scope and the tool registration. Gating only the scope would leave the tool present-but-broken; gating only the tool would request a scope nobody uses and force an unnecessary reinstall.

**Alternative considered:** nesting under a `search: { enabled, ... }` object for future room. Rejected — there is exactly one knob today, and `allowScheduledMessages` sets the precedent for a flat boolean. A future object can be migrated in if a second knob ever appears.

### `search:read.public` added conditionally in `buildScopes()`

Follows the `mentions → app_mentions:read` pattern at `generate-manifest.ts:149` rather than joining `CORE_SCOPES`. The `BotScope` type's `| (string & {})` escape hatch (line 20, added for `assistant:write`) means no type change is needed. No `buildEvents()` change — `message` and `app_mention` are already subscribed whenever DMs or mentions are on, and those are the `action_token` sources.

### Tool always registered when the flag is on; degraded shape when no `action_token`

A session without an `action_token` (reaction trigger, cron fire) still registers `search_messages`, but in a **degraded form**: the parameter schema omits `query`, and the description leads with an explicit statement that search is unavailable in this context and why.

**Why not hide it:** if the tool vanishes, Claude concludes the capability does not exist and tells the user so — which is wrong, and unhelpfully so, since the user need only @mention or DM Clack to get it. Keeping a visibly-disabled tool lets Claude say "I can search, but not from a reaction — @mention me and I'll do it."

**Why not register it fully and error at call time:** a full schema invites Claude to compose a real query, burn a turn, and leak "I tried to search" into user-facing text. Removing `query` makes the unavailability structural rather than advisory.

Calling the degraded tool returns an `errorResult` naming the working triggers. Per repo convention this stays English — it is consumed by Claude, not rendered to Slack.

### `member` role tier

Matches `list_repositories` and `find_emoji`. Slack scopes `search:read.public` results to public channels within workspaces where the app is installed and the searching user is a member — the same content Slack's own search bar already returns to that user. A higher tier would restrict Clack below what the user can trivially do unaided.

### `action_token` threading

Captured off the `message`/`app_mention` payload in `src/slack/handlers/`, carried on the tool context built in `src/tools/context.ts`, and consulted by `src/tools/server.ts` to pick the full or degraded tool shape. Treated as short-lived and per-session: never persisted to `data/sessions/`, never reused across sessions.

## Risks / Trade-offs

- **Enabling the flag requires a full workspace reinstall, not just a manifest re-upload** → Bot tokens do not retroactively gain scopes. Harder than the `dmType` switch documented in CLAUDE.md. Mitigation: the flag defaults off, and a stale token (flag on, reinstall skipped) surfaces Slack's `missing_scope` error verbatim rather than an empty result set.
- **`action_token` lifetime is undocumented** → Slack's docs confirm the emitting events but not validity duration. Mitigation: fetch per session and use immediately; on an auth-class error, return an error naming re-triggering as the remedy rather than retrying blind.
- **Rate limits are low on small workspaces** → ~10 req/min, plus a *user-level* 10/min cap, with pagination counting against both. A Claude turn that paginates aggressively can exhaust a workspace's budget. Mitigation: cap results per call (Slack's `limit` maxes at 20) and bound pagination; the tool description tells Claude to narrow with operators rather than page.
- **Semantic-off behavior is asserted, not yet observed** → `disable_semantic_search` is documented but its exact matching semantics (stemming? phrase handling? does `:bob:` survive tokenization?) are unverified. Mitigation: task list includes a manual probe against a real workspace for the literal `:bob:` case before the tool description promises exact matching.
- **Users will expect reaction search** → "which messages have `:bob:`" most naturally means the reaction. Mitigation: the tool description states the text-only limit explicitly, so Claude can redirect instead of returning a confidently empty answer.

## Migration Plan

Additive and opt-in; no data migration. Enablement is operator-driven: set `allowPublicSearch: true` → `npm run generate-manifest` → upload the manifest → **reinstall the app to the workspace** → restart. Rollback is setting the flag false and restarting; the tool disappears and the now-unused scope is harmless until the next manifest upload.

## Open Questions

- Does `disable_semantic_search: true` preserve a literal `:bob:` through Slack's tokenizer, or does the colon-delimited shortcode get normalized? Determines whether the emoji use case is actually served. **STILL OPEN** — requires a live-workspace probe (task 0.1), which cannot run without a real bot token and the scope granted. Deferred to the manual end-to-end step (7.3); until then the tool description promises "literal keyword matching" but the `:bob:`-survives-tokenization guarantee is asserted, not observed.

## Resolved (de-risk, task group 0)

- **Slack SDK surface (0.2 adjacent):** `@slack/web-api` 7.14.1 does NOT expose `client.assistant.search` — the method is unbundled and untyped. The tool calls it via the generic `client.apiCall("assistant.search.context", { … })`. The response is typed locally (a narrow `zod`-free interface over the documented `results.messages[]` shape) since the SDK ships no type for it.
- **`action_token` field (0.2):** Slack places it as a top-level `action_token` string on the `message`/`app_mention` event payloads. Bolt's TypeScript event types do NOT include it, so the handler reads it via a narrow cast (`(event as { action_token?: string }).action_token`). It is threaded as `actionToken` through `ProcessMessageParams → ProcessingContext → AskClaudeOptions → BuildQueryContextParams → QueryToolContext` — the same shape every other per-run option follows — and never touches `SessionContext` (so it is never persisted).
- **Worker mode (0.3):** the degraded tool is **omitted entirely** in worker mode. `search_messages` is built only in `buildQueryTools`; the worker/tester toolbelts never include it. Worker mode has no Slack conversation to redirect the user to and no `action_token`, so a degraded stub there would be noise. The degraded shape exists only for query-mode sessions that lack an `action_token` (reaction, cron).

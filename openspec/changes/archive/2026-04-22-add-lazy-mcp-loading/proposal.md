## Why

Clack's system prompt baseline is ~131K tokens per query — mostly MCP tool schemas from **9 MCP servers attached to every session**: `clack` (internal), `github` (auto-injected), and 7 external servers from `data/mcp.json` (`sentry`, `statsig`, `metabase`, `monday`, `asana`, `hubspot`, `gcp-observability`). A single 15-tool auto-respond session therefore trips the SDK's auto-compaction threshold mid-investigation, which in turn causes lost context and downstream bugs (e.g., Claude tagging a hallucinated user ID after compaction dropped the real author).

Most queries need zero of the external MCP servers. Attaching all of them on every turn is paying ~100K tokens of cache creation for tools Claude never calls.

## What Changes

We introduce a Clack-owned MCP registry that tags each server as either `alwaysLoad: true` (attached at session start, unchanged behavior) or `alwaysLoad: false` (attached on-demand mid-session via a new internal tool). Topic-specific instructions move out of the always-loaded cascade into per-topic subfolders that only load alongside their corresponding integration.

- **Lazy-load MCP servers on demand.** Only `alwaysLoad: true` servers (defaults: `clack`, `github`) are attached at session start. The rest are attached mid-session via a new internal tool.
- **Clack-owned MCP registry in `data/config.json`** (`mcpServers: { <name>: { alwaysLoad, description } }`). `alwaysLoad` controls session-start attachment; `description` is the "why would Claude use this" string shown in the catalog block. The registry lives in `data/config.json` (not `data/mcp.json`) because `data/mcp.json` must stay in pure Claude SDK shape — adding Clack-specific fields there would fail SDK schema validation.
- **Integrations catalog in the system prompt** — a compact block (~200 tokens) listing non-always-on servers with their `description`, so Claude knows what's available.
- **New tool `attach_integration(name)`** — calls the SDK's `query.setMcpServers()` to dynamically attach a server, and returns the topic's instructions as the tool's text result. This goes into the SDK conversation history rather than the system prompt because the SDK has no API to mutate the system prompt mid-session; tool results in conversation history survive resume and don't require a prompt reload.
- **Topic subfolders in the config cascade** — `data/{default_,}configuration/{role}/topics/<name>/*.md` holds the instructions for a topic/integration. Any number of files per topic; cascade rules unchanged (per-file default → custom override, additive files allowed). Baseline prompt omits these; they arrive via `attach_integration`.
- **Session persistence for attached integrations** — `session.attachedIntegrations: string[]` is persisted and re-attached on every resumed turn (idempotent, survives SDK behavior either way).
- **Attach failures surface in the thinking indicator** — users can see when an integration failed to connect.
- **Graceful handling of unmapped `data/mcp.json` entries** — if an operator adds a new server to `data/mcp.json` without updating the registry, Clack logs a warning and auto-loads that server (effective `alwaysLoad: true` in memory) rather than failing startup. Functionality is preserved; the operator is prompted via the log to add a real registry entry to enable lazy loading.
- **Startup baseline smoke test** — at bot startup, Clack asynchronously runs a minimal single-turn query per role tier (`user`, `dev`, `admin`) and logs each initial `cache_creation_input_tokens`. This is a continuous regression tripwire: if a future change re-inflates the baseline, operators see it in the logs the next time Clack restarts.

## Capabilities

### New Capabilities

- `lazy-mcp-loading` — owns the registry schema, always-on filtering, `attach_integration` tool, dynamic `setMcpServers` orchestration, and session persistence of attached integrations.

### Modified Capabilities

- `cascading-config-resolver` — adds optional topic-subfolder resolution. Baseline resolution (no topics) behaves as today; topic resolution walks `{role}/topics/{topic}/*.md` through the same role × default/custom cascade.
- `claude-code-integration` — MCP server set passed to the SDK at session start is now `alwaysLoad` only, plus previously-attached topics for resumed sessions.

## Impact

- **Code:** `src/config.ts` (registry schema + validation), `src/mcp.ts` (`loadAlwaysOnMcpServers`, `loadMcpServer(name)`), `src/cascadingConfigResolver.ts` (`activeTopics` param, topic walk), `src/claude/promptBuilder.ts` (catalog injection), `src/tools/query/attachIntegration.ts` (new), `src/tools/context.ts` + `src/tools/types.ts` (thread `Query` handle), `src/tools/server.ts` (register tool), `src/claude/index.ts` (always-on subset + re-attach on resume), `src/sessions.ts` (`attachedIntegrations` field).
- **Config:** `data/config.json` gains a required `mcpServers` field with one entry per server defined in `data/mcp.json`. Startup fails fast if any server is missing from the registry.
- **Migration:** existing topical files (metabase.md, monday-integration.md, sentry.md, gcp-logs.md, applauz-hubspot.md, asana-context.md, scheduled-messages.md) move from `{role}/` to `{role}/topics/<name>/` on both default and custom config dirs.
- **Observability:** thinking indicator updates on `attach_integration` start/success/failure so the added latency and any connection errors are visible in-thread.
- **Breaking change risk:** baseline prompt shrinks dramatically; users asking about a non-always-on topic require Claude to attach the integration, which adds a tool-call round-trip. Mitigated by the in-prompt catalog making the capability discoverable.

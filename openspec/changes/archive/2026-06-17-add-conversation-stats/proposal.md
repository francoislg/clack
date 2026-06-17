## Why

Clack accumulates a rich record of every conversation it has had (~834 sessions today in `data/sessions/`), but there is no way to ask it playful, high-level questions about that history — "who pings me most?", "what's my busiest hour?", "longest conversation ever?". The data is already on disk; we just have no tool that aggregates it. A single read-only stats tool turns that latent history into a fun, shareable surface without exposing anything sensitive.

## What Changes

- Add a new read-only MCP query tool **`get_conversation_stats({ from?, to? })`**, available to **all roles**, that scans `data/sessions/*/context.json` and returns one aggregate "fun stats" bundle.
- The tool folds over sessions in a **bounded-concurrency streaming pass** (read-ahead window over `fs.promises.readFile`, fold-as-you-go), giving **O(1)-in-history memory** and overlapping disk I/O with CPU.
- Optional `from`/`to` window; when omitted, scans all-time. Windowed queries **pre-filter by the `createdAt` timestamp encoded in the sessionId** (`<channel>-<ts>-<user>-<createdAt>`), skipping out-of-window files without reading them.
- The returned bundle carries grouped stat families: **core** (top channels, top askers, top DM-askers, longest conversation by turns and by duration, total Clack replies), **temporal** (rush hour, day-of-week, birthday/age, busiest day, after-midnight count), **engagement** (follow-up rate, marathoner, distinct-users/channels reach, times-stayed-quiet), **personality** (most inquisitive, most excitable, politest, most verbose), **content-lite** (links shared, longest single question by word count), **tools** (favourite tool, hardest-working session), and **emoji** (team's top emoji from user text, Clack's signature emoji from assistant text).
- **Privacy contract:** the tool MAY read message text as input, but its output NEVER surfaces conversation content or what anyone asked about — only counts, names, superlatives, and word/length figures. Asker leaderboards exclude bot-initiated triggers (`scheduled`, `autoRespond`); those still count toward Clack's reply totals.
- No new persistence, migration, or config. Purely read-side, modeled on the existing `find_recent_interactions` tool.

## Capabilities

### New Capabilities
- `conversation-stats`: a read-only aggregation tool that computes high-level, non-topical "fun stats" over Clack's own persisted session history and returns them as a single bundle, with optional time windowing and a strict no-content-leakage output contract.

### Modified Capabilities
<!-- None — this is purely additive. -->

## Impact

- **New code:** `src/tools/query/getConversationStats.ts` (+ test), registered ungated in `src/tools/server.ts`.
- **Reads:** `data/sessions/*/context.json` (existing `SessionContext` shape from `src/sessions.ts`); no writes.
- **Token cost:** ~1.2k tokens per call for the full bundle, **flat regardless of history size** (leaderboards are top-N capped; aggregation happens in Node, not in Claude's context). The 31 MB on-disk read is Node I/O, never sent to Claude.
- **Latency:** scan time grows linearly with history; the `from/to` window is the mitigation. A cached rollup is a possible future optimization, out of scope here.
- **Claude-facing instruction:** a short tool description nudging a playful tone and reaffirming the no-content-leakage contract.

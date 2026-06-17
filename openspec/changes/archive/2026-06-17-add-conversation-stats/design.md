## Context

Clack persists one `context.json` per Q&A session under `data/sessions/<sessionId>/`. The sessionId itself encodes the grouping dimensions: `<channelId>-<messageTs>-<userId>-<createdAt>`. Each file (~38 KB avg, 31 MB total across ~834 sessions today) carries the fields needed for aggregate stats — `channelId`, `userId`, `triggerType`, `createdAt`, `lastActivity`, cached `displayName`/`channelName`/`username` (~99% coverage), and a `messages[]` log (roles, timestamps, text, `toolCalls`, `skipped`).

The closest existing tool is `find_recent_interactions` (`src/tools/query/findRecentInteractions.ts`), which enumerates session dirs, reads the most-recent 500, filters, and returns session *snippets*. This change reuses its enumeration pattern but differs fundamentally: it **aggregates the full history into fixed-size accumulators** and returns counts, never session content.

Grounding scans over the real data informed which stats are viable (e.g. token `usage` is 0% populated historically; `trigger.emoji` is empty; FR-language messages are ~0%; code-blocks/choice-clicks are near-zero — all excluded) and which are rich (tool calls 62%, skipped turns 120, links 399, after-midnight 55, emoji shortcodes/unicode plentiful).

## Goals / Non-Goals

**Goals:**
- One read-only MCP tool, all roles, returning a single aggregate "fun stats" bundle.
- Bounded memory regardless of history size (stream one session at a time, fold-as-you-go).
- Overlap disk I/O (libuv threadpool reads) with CPU (main-thread parse + fold).
- Optional `from`/`to` windowing that pre-filters by sessionId-encoded `createdAt` without reading skipped files.
- Strict output contract: no conversation content or topics ever leave the tool — only counts, names, superlatives, and length/word figures.
- Flat ~1.2k-token output via top-N-capped leaderboards.

**Non-Goals:**
- No new persistence, migration, or config.
- No cached/precomputed rollup index (possible future optimization; latency at all-time scale is acceptable now).
- No token/cost stats (`usage` unpopulated historically — would read as all-zeros).
- No `worker-tools`/Changes-Workflow stats (separate dir + file shape; phase-2 candidate).
- No `worker_threads` parallel parsing (premature at this scale).
- No language-mix, emoji-reaction, code-block, or choice-click stats (data too sparse to be meaningful).

## Decisions

### 1. Aggregate in Node, return a bundle — not session snippets to Claude
Folding 31 MB → a ~4.8 KB bundle in Node keeps Claude's token cost flat (~1.2k) and bounded by top-N, independent of history size. Handing raw sessions to Claude would cost ~8M tokens and blow context. The tool is the aggregation boundary.

### 2. Bounded-concurrency streaming fold (window ~8)
Walk session dirs, keep ~8 `fs.promises.readFile` calls in flight (disk reads run on libuv's threadpool), and `JSON.parse` + fold each as it lands on the main thread, then discard it. Peak memory is `concurrency × file-size` + the fixed accumulators → **O(1) in history**. `Promise.all(map(readFile))` (read-all-then-parse) was rejected: it holds the full 31 MB at once and scales with history.
- *Alternative considered — within-file streaming JSON (SAX):* rejected. Files are 38 KB and `JSON.parse` needs the whole document anyway; the right granularity is across-files, not within-file.

### 3. sessionId-timestamp pre-filter for windowed queries
The directory name ends in the session's `createdAt` ms timestamp (`<channel>-<messageTs>-<userId>-<createdAt>`). Note `parseSessionId` returns `channelId`/`messageTs`/`userId` but **not** `createdAt`, so the pre-filter reads the trailing numeric segment of the dir name directly (a small dedicated helper). A windowed `from`/`to` query filters on that and **skips reading out-of-window file bodies entirely** — no parse. Files whose name doesn't parse fall through to being read (correctness over the optimization). All-time queries read everything.

### 4. Top-N accumulators (bounded heaps / capped maps)
Leaderboards keep only top-N (default 10); counters are plain numeric accumulators; histograms are fixed-size arrays (24 hours, 7 days). Distinct-user/channel reach uses a `Set` of IDs (bounded by workspace size, not history). This keeps accumulator memory tiny and the output flat.

### 5. Asker leaderboards exclude bot-initiated triggers
"Top askers", "top DM-askers", and personality/verbosity boards count only human-initiated triggers (`reactions`, `mentions`, `directMessages`). `scheduled` and `autoRespond` sessions still count toward Clack's total replies and tool/temporal stats. Word-count stats also exclude the large cron `trigger.prompt`s to avoid inflation.

### 6. Labels from cached fields, fallback to ID
`displayName`/`channelName` are read from the persisted session (~99% coverage). Missing → fall back to the bare ID. No live Slack resolution inside the tool (Claude has `find_user` if it wants to enrich).

### 7. Reuse, don't reinvent
Reuse `getSessionsDir` (`src/config.ts`), the `textResult`/`errorResult` envelopes (`src/tools/helpers.ts`), and the session types `SessionContext`/`SessionTrigger`/`SessionMessage` (`src/sessions.ts`) — matching `findRecentInteractions`'s patterns. **Deliberately NOT reused:** that tool's `SCAN_LIMIT = 500` mtime cap — fun stats are all-time by design, so the streaming fold scans every in-window session (the `from/to` window, not a count cap, is the bound). The bounded-concurrency `mapWithConcurrency` helper currently lives inside the trivia plugin (`freeform/judge.ts`) and can't be imported across the plugin boundary; the streaming fold hand-rolls its ~15-line read-ahead loop rather than extracting a shared util (out of scope).

### 8. Privacy: read content, emit only aggregates
Emoji/word/links/punctuation stats read message text as *input*. The output schema is structurally incapable of carrying message text — only numbers, IDs/names, and emoji tokens. The Claude-facing tool description reaffirms the no-content contract.

## Risks / Trade-offs

- **Scan latency grows linearly with history** → mitigated by the `from/to` window (pre-filters before read). A cached rollup is the escape hatch if all-time scale ever bites; explicitly out of scope now.
- **Word-count stats skew from cron/thread-context bloat** → mitigated by excluding `scheduled`/`autoRespond` triggers and cron `trigger.prompt`s from verbosity boards.
- **Emoji false positives** (numeric `:22:` shortcodes, `→` arrows) → mitigated by requiring a letter in shortcodes and restricting unicode to real emoji blocks (exclude the arrow range).
- **Stat looks "empty" for unpopulated signals** → mitigated by excluding historically-empty signals (usage, language, emoji-reactions, code blocks) at design time rather than emitting zeros.
- **Privacy regression risk if output schema drifts** → mitigated by a typed bundle whose fields are all numeric/identifier/emoji, plus a test asserting no message-text field exists.
- **Corrupt/legacy session files** → fold is permissive: a file that fails to parse is skipped (logged), never aborts the scan (matches `find_recent_interactions` behavior).

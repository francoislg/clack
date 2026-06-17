## 1. Streaming scan + accumulators

- [x] 1.1 Create `src/tools/query/getConversationStats.ts` with a `StatsBundle` type whose fields are exclusively numbers, identifiers/display names, and emoji tokens (no message-text field) — this type is the privacy contract. Reuse `SessionContext`/`SessionTrigger`/`SessionMessage` from `src/sessions.ts`, `getSessionsDir` from `src/config.ts`, and `textResult`/`errorResult` from `src/tools/helpers.ts`
- [x] 1.2 Implement a bounded-concurrency async generator over the sessions dir (read-ahead window ~8 via `fs.promises.readFile`), folding each parsed session into fixed-size accumulators and discarding it; skip-and-log files that fail to parse. Hand-roll the read-ahead loop (the `mapWithConcurrency` helper is trapped in the trivia plugin); do NOT reuse `findRecentInteractions`'s `SCAN_LIMIT` — stats are all-time
- [x] 1.3 Add a window pre-filter that reads `createdAt` from the trailing numeric segment of the dir name (NOT `parseSessionId`, which returns `messageTs`) and skips out-of-window dirs without reading their bodies; half-open `[from, to)`; all-time when `from`/`to` omitted; unparseable names fall through to being read
- [x] 1.4 Implement top-N (N=10) accumulator helper with a deterministic identifier tiebreak (stable regardless of scan order); histograms as fixed-size arrays (24h, 7 days); reach as `Set` of IDs

## 2. Stat families

- [x] 2.1 Core: top channels, top askers, top DM-askers (askers exclude `scheduled`/`autoRespond`; those still count toward Clack replies), longest conversation by turns AND by duration, total Clack replies
- [x] 2.2 Temporal: rush hour, day-of-week, first-session date + active-day age, busiest single day, after-midnight count
- [x] 2.3 Engagement: follow-up rate, marathoner, distinct-user/channel reach, times-stayed-quiet (skipped turns)
- [x] 2.4 Personality: most inquisitive (`?`), most excitable (`!`), politest (`please`/`stp`/`svp`), most verbose — verbosity excludes cron `trigger.prompt`s and bot triggers
- [x] 2.5 Content-lite: links shared, longest single question by WORD COUNT only (never the text)
- [x] 2.6 Tools: most-called tool, hardest-working session by tool-call count
- [x] 2.7 Emoji: team's top emoji (user text) and Clack's signature emoji (assistant text); filter numeric-only `:shortcodes:` and non-emoji symbols (arrows)
- [x] 2.8 Labels: resolve `displayName`/`channelName` from cached session fields, fall back to bare ID, no live Slack lookup

## 3. Tool registration

- [x] 3.1 Implement `createGetConversationStatsTool(ctx)` exporting the MCP tool with `from?`/`to?` schema, returning the bundle via the standard `textResult` envelope
- [x] 3.2 Write the Claude-facing tool description: playful framing + explicit no-content-leakage reminder (English, via-Claude path — not `t()`)
- [x] 3.3 Register ungated in `src/tools/server.ts` beside `createFindRecentInteractionsTool` (line ~407)

## 4. Tests

- [x] 4.1 `getConversationStats.test.ts`: fixture sessions across trigger types → assert core leaderboards, asker exclusion of `scheduled`/`autoRespond`, both longest variants
- [x] 4.2 Assert windowing: out-of-window sessions excluded and their bodies not read (spy on the read path); half-open boundary (`createdAt === from` included, `=== to` excluded); bundle reports `scannedCount` + effective `from`/`to`
- [x] 4.6 Assert deterministic leaderboard tiebreak (tied entities ordered stably) and concrete personality metrics (`?`/`!`/please counts, avg-words verbosity, skipped = stayed-quiet)
- [x] 4.3 Assert emoji split (user vs assistant) and false-positive filtering (`:22:`, arrows excluded)
- [x] 4.4 Assert empty-dir and corrupt-file cases return a well-formed bundle without throwing
- [x] 4.5 Privacy guard test: assert no field anywhere in the bundle carries message-text content (longest-question is a count)

## 5. Verify

- [x] 5.1 `npx tsc` clean, `npx oxlint`/`npx oxfmt --check` on new files, `npm test` green
- [x] 5.2 `openspec validate add-conversation-stats --strict`
- [x] 5.3 Run the tool against the real `data/sessions/` and eyeball the bundle for sanity + confirm ~1.2k-token output size

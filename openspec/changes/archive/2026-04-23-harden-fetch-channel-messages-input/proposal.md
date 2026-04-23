## Why

When a user asked Clack to summarize a channel from yesterday, Claude called `fetch_channel_messages` with ISO 8601 strings for `oldest`/`latest` (the natural format given the delivery context exposes `CURRENT DATE` as ISO). The Slack API expects Unix epoch timestamps, parses the ISO strings as floats (`"2026-04-22T..."` → `2026`), and silently returns zero messages from a 1970 window. Claude then confidently reported "the channel was quiet that day" — a fabricated conclusion caused by a silent argument-contract mismatch. The response shape gave Claude no way to notice its own mistake.

## What Changes

- `fetch_channel_messages` accepts `oldest`/`latest` as either Unix epoch strings (`"1745294400.000000"`, `"1745294400"`) or ISO 8601 / `Date.parse`-compatible strings (`"2026-04-22T00:00:00-04:00"`, `"2026-04-22"`), normalizing to epoch before calling Slack.
- Unparseable `oldest`/`latest` values cause the tool to return a tool-level error (via `errorResult`), so Claude retries instead of silently reporting an empty window.
- The tool's response always echoes the effective window (`oldest`, `latest` as normalized epoch strings, plus an ISO form for self-check) and `has_more`, on both empty and non-empty paths, so Claude can sanity-check the window it actually queried.
- The Zod schema description for `oldest`/`latest` is updated to document the accepted forms.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `channel-context`: `fetch_channel_messages` gains requirements for timestamp input normalization and for always echoing the queried window in the response.

## Impact

- **Code**: `src/tools/query/fetchChannelMessages.ts` (schema description, handler), `src/tools/query/fetchChannelMessages.test.ts` (new coverage for normalization and window echo). No other call sites or tools pass user-supplied Slack timestamps, so the blast radius is local.
- **APIs**: Additive changes to the MCP tool's response object (`oldest`, `latest`, `oldest_iso`, `latest_iso`, `has_more` on both branches). No existing consumer parses this output programmatically — it's agent-consumed.
- **Dependencies**: None. `Date.parse` is built-in.
- **Behavior**: Trivia flows and other callers that invoke `fetch_channel_messages` without timestamps are unaffected.

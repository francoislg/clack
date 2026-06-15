## Why

When a user asked Clack to "compare the date the feature was done vs. the date of the ticket," the `git_log` and `find_pull_requests` tools each returned ~100K-character responses that exceeded the Agent SDK's inline token cap. The SDK dumped them to `tool-results/*.txt` files as single-escaped-line JSON, which Claude's line-oriented `Grep` could not read. Claude then fell back to paginating `list_commits` page-by-page, exhausted its turn budget, and **never delivered an answer**. Both tools answer needle questions ("when was X merged?") with a full haystack — and the haystack doesn't even reach Claude usefully.

## What Changes

- **`git_log`** keeps its `args[]` passthrough (the power path) and gains first-class `path`, `limit`, and `since` parameters that map to `git log` flags — so the lean, targeted query Claude naturally reaches for (`{ path, limit }`) is expressible instead of guessing nonexistent params and falling back to an unbounded log.
- **`git_log`** stops silently truncating oversized output to 100K chars (which still overflowed). Instead, when output exceeds a safe inline budget, it **refuses** with an `errorResult` that suggests how to narrow (`limit`, `path`, `since`/`--since`, `--oneline`, `-S<string>`/`--grep`). No silent injection of format or limit — Claude's `args` run exactly as given. **BREAKING** (tool-contract): the `truncated` field and truncation behavior are removed.
- **`find_pull_requests`** becomes lean by construction: the body is **dropped** from list results, rows are capped, and results carry only `number`/`title`/`state`/`branch`/`author`/`createdAt`/`mergedAt`.
- **`find_pull_requests`** gains `offset`/`limit` pagination plus a total count (the `find_session_transcript` house pattern), so results are retrievable piece by piece. Reading one PR's full body/diff/reviews is delegated to the `github` MCP (no built-in body retrieval), surfaced in the tool description.
- A shared output-budget constant (well under the SDK inline token limit) replaces the per-tool `100_000` literal so results and refusals always return inline.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `git-log-tools`: the `git_log` requirement adds `path`/`limit`/`since` parameters and replaces character-truncation with a refuse-when-oversize behavior carrying narrowing suggestions.
- `clack-tools`: the `find_pull_requests` requirement drops body from list output, caps and paginates results (`offset`/`limit` + total), and delegates single-PR body retrieval to the `github` MCP.

## Impact

- Code: `src/tools/query/gitLog.ts`, `src/tools/query/findPullRequests.ts`, and a shared budget constant (new or in `src/tools/helpers.ts`). Tests: `gitLog.test.ts`, `findPullRequests.test.ts`.
- Tool contract: `git_log` response no longer includes `truncated`; oversized queries now error instead of returning partial output. `find_pull_requests` list items no longer include `body`; response shape gains pagination metadata.
- No config, persistence, or migration impact. No change to role gating or repo-access checks.

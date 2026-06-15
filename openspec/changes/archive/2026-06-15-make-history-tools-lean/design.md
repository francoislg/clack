## Context

`git_log` and `find_pull_requests` are query-mode MCP tools. Both answer "needle" questions (when was X committed/merged?) but return full result sets:

- `git_log` (`src/tools/query/gitLog.ts`) forwards an arbitrary `args[]` array to `git.raw(["log", ...args])` and truncates output at `MAX_OUTPUT_CHARS = 100_000`. That cap is *above* the Agent SDK's per-tool-result inline token limit (~25K tokens ≈ ~100K English chars, denser for JSON/diffs), so even "truncated" output overflows. The SDK then writes the result to a `tool-results/*.txt` file as a one-line escaped JSON array, which Claude's line-oriented `Grep` cannot search.
- `find_pull_requests` (`src/tools/query/findPullRequests.ts`) fetches `per_page: 100` PRs and returns each with a 500-char body slice and six fields — ~98K chars for a busy repo, same overflow.

The real-world failure (debug session `070203be…`): Claude first tried the correct lean query `git_log({ repo, path, limit: 5 })`, but `path`/`limit` are not tool parameters — only `{ repo, args[], branch }` exist. After validation errors it fell back to an unbounded `git log`, overflowed, could not read the dumped file, paginated `list_commits` 10× instead, and ran out of turns without ever calling `submit_response`.

Constraints: query tools are role-gated and repo-access-checked (must preserve). `find_session_transcript` already establishes the house pagination shape (`offset` + `limit` + total count). The `github` MCP is available on-demand via `attach_integration("github")` and already exposes single-PR reads.

## Goals / Non-Goals

**Goals:**
- Lean by default: the common query returns a small, inline result that always reaches Claude.
- Retrievable piece by piece: narrowing (the primary lever) plus pagination/drill-in for when a lean list is still long.
- The tool schema and error messages are self-documenting — Claude expresses the lean query directly instead of guessing.
- Clack tools never trigger the SDK's overflow-to-file path.

**Non-Goals:**
- Rebuilding `git_log` into a full git wrapper. We add only the params Claude actually reaches for (`path`, `limit`, `since`); everything else stays in `args[]`.
- A built-in PR/commit body-retrieval tool for `find_pull_requests` (delegated to the `github` MCP).
- A systemic guard inside `textResult` that caps every tool's output. Named as a follow-up; this change is scoped to the two tools that overflowed.
- Changing role gating, repo-access checks, or `deepen_history`.

## Decisions

### D1: `git_log` keeps `args[]` and adds first-class `path` / `limit` / `since` (A3 hybrid)

`args[]` is the flexible power path and stays untouched. We add three optional first-class params that map to git flags and compose with `args[]`:

- `path: string | string[]` → appended as `-- <path>...`
- `limit: number` → `-n <limit>`
- `since: string` → `--since=<since>`

Rationale: the trace shows Claude's mental model is `{ path, limit }`, not `{ args: ["log","--","p"] }`. Making those first-class removes the guess-and-fail-and-firehose loop. `since` is included (over `search`/`-S`) per the explore decision; pickaxe/`--grep`/`author` remain available through `args[]` and are named in the refusal suggestions.

*Alternative considered:* strip `args[]` entirely for a fully structured schema (A1) — rejected; the user values the passthrough and it covers the long tail. Keeping both means a first-class param and an equivalent `args` flag could be passed together; we apply first-class params *in addition to* `args` (e.g. both `-n` flags present), letting git's last-wins semantics resolve it rather than de-duping.

### D2: Refuse-when-oversize instead of truncate (no silent injection)

Replace the truncate-to-100K branch with: build the full `git log` output, and if it exceeds a safe budget, return `errorResult` with a message that states the approximate size and lists concrete narrowing moves (`limit`, `path`, `since`/`--since`, `--oneline`, `-S<string>`/`--grep`). On success, return `{ output, shallow, availableCommits }` (drop `truncated`).

Rationale: a truncated arbitrary log is misleading (Claude can't tell it's partial, and the cut may land mid-relevant-data) and at 100K still overflowed. A refusal is honest, tiny (always inline), and teaches the narrowing recipe exactly when needed. We deliberately do **not** inject a default `--pretty`/`-n`: injection hides what Claude actually ran and second-guesses its `args`; the refusal suggestion `--oneline` lets Claude compact on its own terms.

*Alternative considered:* defaults + refuse-as-backstop (inject `--oneline` + default `-n` so the trivial call never refuses) — rejected per explore; the honesty of "run exactly what was asked, bounce if too big" won over saving one round-trip.

### D3: Shared output-budget constant under the SDK inline limit

Introduce one shared constant (e.g. `MAX_TOOL_OUTPUT_CHARS`, ~40K chars) replacing the per-tool `100_000` literal, sized safely below the SDK's inline token cap so any result at/under budget returns inline. `git_log` refuses above it; `find_pull_requests` is lean enough by construction (D4) to stay under it.

*Alternative considered:* a token-count estimate instead of a char budget — rejected as over-engineering; a conservative char budget is simpler and the SDK cap is the only thing we must stay under.

### D4: `find_pull_requests` lean-by-construction + pagination + github-MCP drill-in

- **Drop `body`** from list items. Keep `number`, `title`, `state` (`open`/`closed`/`merged`), `branch`, `author`, `createdAt`, `mergedAt`, `url`.
- **Paginate** with `offset` (default 0) and `limit` (default e.g. 20, bounded) applied after state/branch/since filtering; return `{ pullRequests, total, offset, limit }` so Claude can request the next slice. `total` is the filtered count.
- **Drill-in delegated:** the tool description tells Claude to `attach_integration("github")` and fetch a single PR's body/diff/reviews by number. No built-in body retrieval.

Rationale: with body removed and rows capped, the response can't approach the budget, so no refusal path is needed here. Pagination matches `find_session_transcript`. Delegating body retrieval avoids reintroducing a heavy dependency in the default path while keeping it one hop away. This also corrects the now-stale spec (which claims open-PRs-only and a 5-field shape) to match the tool's real state/since support.

## Risks / Trade-offs

- **Refusal adds a round-trip when Claude overshoots** → the error message is an explicit recipe, so the retry is a narrowed query, not blind flailing — strictly better than the current dead-end-then-timeout.
- **Removing `truncated` / `body` is a tool-contract break** → these are model-facing MCP tools with no external consumers; the prompt/tool descriptions are updated in the same change, and English tool text needs no i18n.
- **First-class param + equivalent `args` flag both supplied** → git's last-flag-wins resolves duplicates (e.g. two `-n`); acceptable and documented, no de-dup logic needed.
- **`find_pull_requests` paginates only within the GitHub page already fetched** → for the targeted "recent PRs, narrowed by state/since/branch" use case 100 fetched rows is ample; deep pagination past that is out of scope (named in Open Questions).
- **Budget too low could refuse legitimately useful logs** → ~40K chars is still hundreds of `--oneline` commits; the suggestion set steers toward `--oneline`/`limit` which keep far more signal per char.

## Migration Plan

Pure code change to two query tools plus a shared constant. No data, config, or persistence migration. Deploy via the normal image rollout. Rollback = revert the commit; no state to unwind. Update the two spec files and tool descriptions in the same change.

## Open Questions

- Exact budget value for `MAX_TOOL_OUTPUT_CHARS` (proposed ~40K) — confirm against the SDK's actual inline cap during implementation.
- `find_pull_requests` default/maximum `limit` (proposed default 20) and whether `offset` should ever fetch beyond the first GitHub page (currently no — bounded to the fetched set).
- Whether to also accept `--grep`/pickaxe as first-class later, or leave them in `args[]` permanently (current decision: `args[]`).

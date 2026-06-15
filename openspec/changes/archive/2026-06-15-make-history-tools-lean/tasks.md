## 1. Shared output budget

- [x] 1.1 Add a shared `MAX_TOOL_OUTPUT_CHARS` constant (~40K, confirm against the SDK inline cap) in `src/tools/helpers.ts` (or a small shared module) and export it
- [x] 1.2 Remove the per-tool `MAX_OUTPUT_CHARS = 100_000` literal in `src/tools/query/gitLog.ts` in favor of the shared constant

## 2. git_log — first-class params

- [x] 2.1 Add optional `path` (`string | string[]`), `limit` (`number`), and `since` (`string`) to the `git_log` zod input schema with clear descriptions
- [x] 2.2 Build the git args by combining `["log", ...args]` with `-n <limit>`, `--since=<since>`, and trailing `-- <path>...` (no dedup — rely on git's last-wins)
- [x] 2.3 Keep the existing `repo` resolution, worker-branch shortcut, and access checks unchanged

## 3. git_log — refuse-when-oversize

- [x] 3.1 Replace the truncate-to-`MAX_OUTPUT_CHARS` branch with a refusal: when `output.length > MAX_TOOL_OUTPUT_CHARS`, return `errorResult(...)` and do NOT return partial output
- [x] 3.2 Write the refusal message to state the result was too large and list narrowing suggestions: `limit`, `path`, `since`/`--since`, `--oneline`, `-S<string>`/`--grep`
- [x] 3.3 On success, return `{ output, shallow, availableCommits }` and remove the `truncated` field from the response
- [x] 3.4 Update the `git_log` tool description to surface `path`/`limit`/`since` and the lean-query guidance

## 4. find_pull_requests — lean list + pagination

- [x] 4.1 Drop `body` from the mapped result objects; keep `number`, `title`, `state`, `branch`, `author`, `createdAt`, `mergedAt`, `url`
- [x] 4.2 Add optional `offset` (default 0) and `limit` (default 20, bounded) to the zod input schema
- [x] 4.3 Apply state/branch/since filtering first, then slice `[offset, offset+limit)`, and return `{ pullRequests, total, offset, limit }` where `total` is the filtered count
- [x] 4.4 Update the tool description: lean list, how to paginate, and to attach the `github` integration for a single PR's full body/diff/reviews

## 5. Tests

- [x] 5.1 `gitLog.test.ts`: cover `path`/`limit`/`since` arg construction, composition with `args`, the refuse-when-oversize path (asserting the suggestion text and no partial output), and the success response shape (no `truncated`)
- [x] 5.2 `findPullRequests.test.ts`: cover body omission, the lean field set, pagination slice + `total`/`offset`/`limit` metadata, and existing state/branch/since filters
- [x] 5.3 Run `npx tsc`, `npx oxlint` on changed files, `npx oxfmt --check`, and `npm test`

## 6. Verify

- [x] 6.1 Manually confirm a broad `git_log` (no limit) now returns a clear refusal with suggestions, and that `git_log({ repo, path, limit })` returns lean inline output
- [x] 6.2 Confirm a busy-repo `find_pull_requests` response stays well under `MAX_TOOL_OUTPUT_CHARS` and never triggers the SDK overflow-to-file path
- [x] 6.3 Update `graphify update .` if code structure changed

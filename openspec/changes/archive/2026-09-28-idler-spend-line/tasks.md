## 1. Usage helpers

- [x] 1.1 In `src/claude/usage.ts`, add `totalTokens(usage: SessionUsage): number`, the sum of the four token components.
- [x] 1.2 In `src/claude/usage.ts`, add `formatUsageSummary(usage: SessionUsage): string`. It returns `~$<cost 2dp> · <total> tokens (<cacheRead> cached)`, formats counts at three significant digits with a K/M suffix (below 1,000 as a plain integer), and omits the cached part when `cacheReadTokens` is 0.
- [x] 1.3 In `src/claude/usage.test.ts`, test `totalTokens`, the abbreviation boundaries (84 → `84`, 999 → `999`, 1,000 → `1.00K`, 7,378 → `7.38K`, 425,833 → `426K`, 999,999 → `1.00M`, 5,526,301 → `5.53M`), the 2026-09-28 example (`~$2.93 · 5.53M tokens (5.09M cached)`), the zero case (`~$0.00 · 0 tokens`), and a non-zero case without cache reads (input 100, output 50, cost 0.01 → `~$0.01 · 150 tokens`).

## 2. find_recent_interactions

- [x] 2.1 In `src/tools/query/findRecentInteractions.ts`, widen `SearchResult.totalUsage` to `SessionUsage & { totalTokens: number; summary: string }`. Attach both fields from the helpers on the aggregate path and on the missing-sessions-dir zero path.
- [x] 2.2 Update the `include` parameter description so `"usage"` mentions `totalTokens` and the ready-to-print `summary`.
- [x] 2.3 In `src/tools/query/findRecentInteractions.test.ts`, assert `totalUsage` carries `totalTokens` and `summary` on a populated window and on an empty one. Partially `vi.mock` `../../claude/usage.js` so `totalTokens`/`formatUsageSummary` are mocks while `addUsage`/`ZERO_USAGE` stay real. Assert the mocks are called with the summed aggregate and that their return values appear on `totalUsage`. Do not assert formatting here.

## 3. Idler activity window

- [x] 3.1 In `src/plugins/idler/activity.ts`, add optional `windowStart: z.number().optional()` to the activity schema. `clearActivity` writes `{ entries: [], windowStart: Date.now() }`, and `appendActivity` keeps the existing `windowStart`.
- [x] 3.2 In `src/plugins/idler/tools/activity.ts`, `read_activity` returns `windowStart` (`null` when absent). Update the tool descriptions: `read_activity` explains `windowStart` as the log's window start to pass as `find_recent_interactions`'s `since`.
- [x] 3.3 Tests: `activity.ts` (clear stamps `windowStart` under fake timers, append keeps it, a legacy file without it parses) and `read_activity` (returns `windowStart` or `null`), following the existing idler test files' fakes.

## 4. Idler summary prompt

- [x] 4.1 In `src/plugins/idler/prompts/summary.ts`:
  - Step 2 passes `since: <windowStart from read_activity>` verbatim, or `since_hours: 24` when `windowStart` is null.
  - The spend line prints `🧮 Spend: <totalUsage.summary>` verbatim, with no arithmetic and no reformatting.
  - Keep the omit-only-on-call-failure rule.
  - Update the module doc comment to match.
- [x] 4.2 Update `src/plugins/idler/prompts/summary.test.ts` to assert the new instructions. The prompt must reference `windowStart`/`since`, the `since_hours: 24` fallback, and `totalUsage.summary`, and must no longer mention `inputTokens + outputTokens`.

## 5. Verify

- [x] 5.1 `npx tsc --noEmit`, `npx oxlint` + `npx oxfmt --check` on touched files, `npm test`.
- [x] 5.2 `openspec validate idler-spend-line --strict`.
- [x] 5.3 `graphify update .`
